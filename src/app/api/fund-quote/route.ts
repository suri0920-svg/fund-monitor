import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// 天天基金估值接口代理（解决浏览器跨域）
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "缺少 code 参数" }, { status: 400 });
  }

  try {
    const res = await fetch(`http://fundgz.1234567.com.cn/js/${code}.js`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ error: `基金接口返回 ${res.status}` }, { status: 502 });
    }

    const text = await res.text();

    // 解析 jsonpgz({...}); 格式 —— 基金名可能含括号，取首尾大括号
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: "该基金代码不存在或无估值数据" }, { status: 404 });
    }

    const data = JSON.parse(text.slice(start, end + 1));
    return NextResponse.json({
      success: true,
      data: {
        code: data.fundcode,
        name: data.name,
        navDate: data.jzrq,       // 净值日期
        dwjz: parseFloat(data.dwjz),  // 昨日单位净值
        gsz: parseFloat(data.gsz),    // 今日估算净值
        gszzl: parseFloat(data.gszzl),// 估算涨跌幅 %
        gztime: data.gztime,      // 估值时间
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "请求失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
