import type { Holding, DraftHolding, DailySnapshot } from "./types";

// ────────────────────────────────────────────────────────────
// Mock 持仓数据：6 只基金（3 只支付宝 + 3 只招行）
// 模拟从支付宝/招行 App 列表页 + 详情页完整抓取的所有字段
// ────────────────────────────────────────────────────────────

export const mockHoldings: Holding[] = [
  {
    id: "h-161725",
    code: "161725",
    name: "招商中证白酒指数",
    channel: "alipay",
    shares: 5230.45,
    costPrice: 1.182,
    startDate: "2025-12-20",
    marketValue: 6584.51,
    totalProfit: 402.22,
    totalProfitRate: 6.51,
    todayProfit: 69.57,
    todayRate: 1.07,
  },
  {
    id: "h-005827",
    code: "005827",
    name: "易方达蓝筹精选混合",
    channel: "alipay",
    shares: 3180.2,
    costPrice: 2.9145,
    startDate: "2026-01-15",
    marketValue: 8495.93,
    totalProfit: -773.11,
    totalProfitRate: -8.34,
    todayProfit: -37.53,
    todayRate: -0.44,
  },
  {
    id: "h-163417",
    code: "163417",
    name: "兴全合宜灵活配置混合",
    channel: "alipay",
    shares: 8450.0,
    costPrice: 1.623,
    startDate: "2026-02-10",
    marketValue: 13470.99,
    totalProfit: -243.36,
    totalProfitRate: -1.77,
    todayProfit: 57.46,
    todayRate: 0.43,
  },
  {
    id: "h-161005",
    code: "161005",
    name: "富国天惠成长混合",
    channel: "cmb",
    shares: 2680.5,
    costPrice: 3.452,
    startDate: "2026-03-05",
    marketValue: 8421.24,
    totalProfit: -831.49,
    totalProfitRate: -8.99,
    todayProfit: 46.37,
    todayRate: 0.55,
  },
  {
    id: "h-001938",
    code: "001938",
    name: "中欧时代先锋股票A",
    channel: "cmb",
    shares: 4120.8,
    costPrice: 2.854,
    startDate: "2026-04-01",
    marketValue: 11203.34,
    totalProfit: -557.95,
    totalProfitRate: -4.74,
    todayProfit: -64.28,
    todayRate: -0.57,
  },
  {
    id: "h-260108",
    code: "260108",
    name: "景顺长城新兴成长混合",
    channel: "cmb",
    shares: 3650.0,
    costPrice: 2.145,
    startDate: "2026-04-25",
    marketValue: 8327.48,
    totalProfit: 498.23,
    totalProfitRate: 6.36,
    todayProfit: 47.82,
    todayRate: 0.58,
  },
];

// ────────────────────────────────────────────────────────────
// Mock 截图解析结果：点「模拟解析」时填充到校正表单
// 模拟从支付宝列表页抓取（详情页字段留空，让用户补全）
// ────────────────────────────────────────────────────────────

export const mockParsedDrafts: DraftHolding[] = [
  {
    id: "d-000961",
    name: "天弘沪深300ETF联接A",
    code: "000961",
    shares: 0,
    costPrice: 0,
    channel: "alipay",
    marketValue: 7596.18,
    totalProfit: 312.45,
    totalProfitRate: 4.29,
    todayProfit: 18.63,
    todayRate: 0.25,
  },
  {
    id: "d-160632",
    name: "鹏华中证酒指数",
    code: "160632",
    shares: 0,
    costPrice: 0,
    channel: "cmb",
    marketValue: 5367.38,
    totalProfit: -148.92,
    totalProfitRate: -2.7,
    todayProfit: -8.41,
    todayRate: -0.16,
  },
];

// ────────────────────────────────────────────────────────────
// Mock 历史快照（用于趋势线展示，避免第一天没数据）
// 最近 14 天的总资产/今日收益轨迹
// ────────────────────────────────────────────────────────────

function genMockSnapshots(): DailySnapshot[] {
  const today = new Date("2026-06-08");
  const snapshots: DailySnapshot[] = [];
  // 模拟总资产从 54000 缓慢爬升到 56500，每日收益在 +120 ~ -60 之间波动
  const baseAssets = 54000;
  const baseTotalProfit = -2800;
  let cumProfit = baseTotalProfit;
  let assets = baseAssets;

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // 当日收益（模拟）
    const dayProfit = Math.round(
      (Math.sin(i * 0.7) * 80 + Math.cos(i * 1.3) * 50 + 30) * 100,
    ) / 100;
    cumProfit += dayProfit;
    assets = baseAssets + (cumProfit - baseTotalProfit);
    snapshots.push({
      date: dateStr,
      timestamp: d.getTime(),
      totalAssets: Math.round(assets * 100) / 100,
      todayProfit: dayProfit,
      totalProfit: Math.round(cumProfit * 100) / 100,
      byChannel: {
        alipay: {
          assets: Math.round(assets * 0.505 * 100) / 100,
          todayProfit: Math.round(dayProfit * 0.5 * 100) / 100,
          count: 3,
        },
        cmb: {
          assets: Math.round(assets * 0.495 * 100) / 100,
          todayProfit: Math.round(dayProfit * 0.5 * 100) / 100,
          count: 3,
        },
      },
    });
  }
  return snapshots;
}

export const mockSnapshots: DailySnapshot[] = genMockSnapshots();
