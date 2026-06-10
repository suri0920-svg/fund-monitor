import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type Channel = "alipay" | "cmb";

// ── 用基金名称反查代码（与 /api/fund-search 同源）──
// 用于校验 AI 从截图里识别的 fund_code，或覆盖 AI 虚构的 code
async function searchFundCodeByName(
  name: string,
): Promise<{ code: string; name: string } | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;
  try {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://fund.eastmoney.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const rawDatas = (data as { Datas?: unknown })?.Datas;
    const funds: Array<{ CODE?: string; NAME?: string; CATEGORY?: number }> = Array.isArray(rawDatas)
      ? rawDatas.filter((d: { CATEGORY?: number }) => d.CATEGORY === 700)
      : [];
    if (!funds.length) return null;
    const exact = funds.find((d) => String(d.NAME ?? "") === trimmed);
    if (exact) return { code: String(exact.CODE ?? ""), name: String(exact.NAME ?? "") };
    const fuzzy = funds.find((d) => {
      const n = String(d.NAME ?? "");
      return n && (n.includes(trimmed) || trimmed.includes(n));
    });
    if (fuzzy) return { code: String(fuzzy.CODE ?? ""), name: String(fuzzy.NAME ?? "") };
    return { code: String(funds[0].CODE ?? ""), name: String(funds[0].NAME ?? "") };
  } catch {
    return null;
  }
}

// ── 数字清洗 ──
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  const s = v
    .replace(/[￥¥$,%\s]/g, "")
    .replace(/[，]/g, "")
    .replace(/^[约≈~]/, "")
    .trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// 用户 prompt 要求 cost_price/holding_shares 看不到返回 null，这里转 0
function nullableNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return toNum(v);
}

// "19.95%" → 19.95；纯数字直接用
function parsePercent(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const s = v.replace(/%/g, "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// "Alipay" / "CMB" → "alipay" / "cmb"
function parseChannel(v: unknown, fallback: Channel): Channel {
  const s = String(v ?? "").toLowerCase();
  if (s === "cmb") return "cmb";
  if (s === "alipay") return "alipay";
  return fallback;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  if (!apiKey && !authToken) {
    return NextResponse.json(
      { error: "未配置 API 凭证，请在 .env.local 中设置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN" },
      { status: 500 },
    );
  }

  try {
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const platformParam = (formData.get("platform") as string) || "alipay";
    const fallbackChannel: Channel = platformParam === "cmb" ? "cmb" : "alipay";

    if (!imageFile) {
      return NextResponse.json({ error: "未找到图片文件" }, { status: 400 });
    }

    const bytes = await imageFile.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const rawType = imageFile.type || "image/png";
    const mediaType = rawType as "image/png" | "image/jpeg" | "image/gif" | "image/webp";

    const client = new Anthropic({
      apiKey: apiKey ?? null,
      authToken: authToken ?? null,
      baseURL: baseURL ?? null,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: `你是一个严格的金融账单数据提取助手。用户上传了一张支付宝或招商银行的单只基金资产详情截图。请遵循以下铁律进行解析：

1. 【目标锁定】：单张截图只对应【一只】核心基金。请忽略走势图、坐标轴数字、底部标签栏、讨论区以及任何推荐信息。只提取页面最顶部的核心大字资产信息。

2. 【核心字段定义提取】：
   - fund_name (基金名称): 位于顶部的粗体大字（如：易方达裕丰回报债券A / 华夏中证5G通信主题ETF联接C）
   - fund_code (基金代码): 基金名称下方的6位数字（如：000171 / 008087）
   - platform (渠道): 检查界面特征。如果是支付宝/蚂蚁财富界面（带有"讨论区"、"诊基"或蓝色买入按钮），归类为 "Alipay"；如果是招商银行，归类为 "CMB"。
   - current_value (当前总金额): 页面中间最大号字体的数字（如：331.12 / 6019.58）
   - cost_price (持仓成本价): 仅从明确写有"持仓成本价"的字样后面提取。如果画面中没有这五个字（如部分截图未展开），必须返回 null，绝对不能编造！
   - holding_shares (持有份额): 仅从明确写有"持有份额"的字样后面提取。如果画面中没有这四个字，必须返回 null，绝对不能编造！

3. 【数据校验逻辑（核心优化点）】：
   - 如果能够提取到 cost_price 和 holding_shares，请直接使用。
   - 如果 cost_price 或 holding_shares 为 null，但在截图中能提取到"持有收益(元)"（如 +59.86）和"持有收益率"（如 +19.95%），请在 JSON 中额外返回这两个字段：total_profit 和 total_profit_rate。

4. 【输出格式】：请严格返回如下 JSON 数组格式，不要包含任何 markdown 标记（如 \`\`\`json），不要包含任何解释文本：
[
  {
    "fund_name": "xxx",
    "fund_code": "xxx",
    "platform": "Alipay",
    "current_value": 0.0,
    "cost_price": 0.0,
    "holding_shares": 0.0,
    "total_profit": 0.0,
    "total_profit_rate": "0.0%"
  }
]`,
            },
          ],
        },
      ],
    });

    const block = response.content[0];
    const text = block && block.type === "text" ? block.text : "";

    // 去掉可能的 markdown 代码块包裹
    const cleaned = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed: unknown = JSON.parse(cleaned);

    // 兼容 AI 返回数组 / 单对象 / {holdings: [...]} 三种形式
    let rawList: Array<Record<string, unknown>> = [];
    if (Array.isArray(parsed)) {
      rawList = parsed as Array<Record<string, unknown>>;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      rawList = Array.isArray(obj.holdings)
        ? (obj.holdings as Array<Record<string, unknown>>)
        : [obj];
    }

    // 单图一只基金铁律：AI 违反 prompt 多输出时，只取第一只合法的
    const seenCodes = new Set<string>();
    const cleanedHoldings: Array<{
      name: string;
      code: string;
      channel: Channel;
      marketValue: number;
      costPrice: number;
      shares: number;
      totalProfit: number;
      totalProfitRate: number;
      todayProfit: number;
      todayRate: number;
    }> = [];
    let detectedChannel: Channel = fallbackChannel;

    for (const h of rawList) {
      if (!h || typeof h !== "object") continue;
      const name = String(h.fund_name ?? h.name ?? "").trim();
      const code = String(h.fund_code ?? h.code ?? "").trim();
      if (!name) continue;
      if (!/^\d{6}$/.test(code)) continue;
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      detectedChannel = parseChannel(h.platform, detectedChannel);
      cleanedHoldings.push({
        name,
        code,
        channel: detectedChannel,
        marketValue: toNum(h.current_value ?? h.marketValue),
        costPrice: nullableNum(h.cost_price ?? h.costPrice),
        shares: nullableNum(h.holding_shares ?? h.shares),
        totalProfit: toNum(h.total_profit ?? h.totalProfit),
        totalProfitRate: parsePercent(h.total_profit_rate ?? h.totalProfitRate),
        todayProfit: toNum(h.today_profit ?? h.todayProfit),
        todayRate: toNum(h.today_rate ?? h.todayRate),
      });
      break; // 单图一只基金
    }

    if (rawList.length > 1) {
      console.log(
        `[parse-fund] ⚠ AI 返回 ${rawList.length} 条，按"单图一只"铁律只取第一只合法的`,
      );
    }

    // 名称反查校验/纠正 code
    const verifiedHoldings = [];
    for (const h of cleanedHoldings) {
      const searchResult = await searchFundCodeByName(h.name);
      let finalCode = h.code;
      let verifyStatus: "matched" | "corrected" | "unverified" = "unverified";
      let searchedName = "";
      if (searchResult) {
        searchedName = searchResult.name;
        if (h.code === searchResult.code) {
          verifyStatus = "matched";
        } else {
          finalCode = searchResult.code;
          verifyStatus = "corrected";
        }
      }
      verifiedHoldings.push({
        ...h,
        code: finalCode,
        verifyStatus,
        searchedName,
      });
    }

    const stats = {
      matched: verifiedHoldings.filter((h) => h.verifyStatus === "matched").length,
      corrected: verifiedHoldings.filter((h) => h.verifyStatus === "corrected").length,
      unverified: verifiedHoldings.filter((h) => h.verifyStatus === "unverified").length,
    };
    console.log(
      `[parse-fund] platform=${detectedChannel}, AI 原始 ${rawList.length} → 取第一只 ${cleanedHoldings.length}（✓${stats.matched} ⚠${stats.corrected} ?${stats.unverified}）`,
    );

    return NextResponse.json({
      success: true,
      data: {
        platform: detectedChannel,
        holdings: verifiedHoldings,
      },
      meta: {
        rawCount: rawList.length,
        count: verifiedHoldings.length,
        stats,
        truncated: response.stop_reason === "max_tokens",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
