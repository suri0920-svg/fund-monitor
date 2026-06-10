import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// 天天基金「基金名称 → 代码」搜索代理（解决浏览器跨域）
// 用于根据 AI 识别的基金名称反查代码，与截图里的 code 做校验
export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get("keyword")?.trim();
  if (!keyword || keyword.length < 2) {
    return NextResponse.json({ error: "关键词至少 2 个字" }, { status: 400 });
  }

  try {
    const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://fund.eastmoney.com/",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ error: `搜索接口返回 ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const funds = (Array.isArray(data.Datas) ? data.Datas : [])
      .filter((d: { CATEGORY?: number }) => d.CATEGORY === 700) // 只保留基金
      .slice(0, 10)
      .map((d: { CODE?: string; NAME?: string }) => ({
        code: String(d.CODE ?? ""),
        name: String(d.NAME ?? ""),
      }));

    return NextResponse.json({ success: true, data: funds });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "请求失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
