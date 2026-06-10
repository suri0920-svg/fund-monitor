// 基金相关共享类型

// ────────────────────────────────────────────────────────────
// 双 Tab 架构使用的核心类型
// ────────────────────────────────────────────────────────────

export type Channel = "alipay" | "cmb";

/**
 * 持仓（前端持久化结构）
 * - 基本字段：shares / costPrice（详情页才有）
 * - 截图字段（可选）：marketValue / totalProfit / totalProfitRate / todayProfit / todayRate
 *   支付宝列表页截图直接给的；列表页通常没有 shares/costPrice
 */
export interface Holding {
  id: string;
  code: string;
  name: string;
  channel: Channel;
  shares: number; // 持有份额
  costPrice: number; // 成本净值（每份）
  startDate: string; // 买入日期 YYYY-MM-DD

  // 截图直接抓取的字段（优先用，列表页就有）
  marketValue?: number; // 持有金额（市值）
  totalProfit?: number; // 累计收益（持有收益，元）
  totalProfitRate?: number; // 累计收益率 %
  todayProfit?: number; // 今日收益（元）
  todayRate?: number; // 今日涨幅 %
}

/** 截图导入校正表单可编辑结构 */
export interface DraftHolding {
  id: string;
  name: string;
  code: string;
  shares: number;
  costPrice: number;
  channel: Channel;
  marketValue: number;
  totalProfit: number;
  totalProfitRate: number;
  todayProfit: number;
  todayRate: number;
  // 名称反查校验状态（由 /api/parse-fund 后端填充）
  verifyStatus?: "matched" | "corrected" | "unverified";
  searchedName?: string;
}

// ── 派生计算（截图字段优先，没有时回退到份额×净值计算）──
export function marketValue(h: Pick<Holding, "shares" | "costPrice" | "marketValue">): number {
  if (typeof h.marketValue === "number" && h.marketValue > 0) return h.marketValue;
  return 0; // 列表页没有 marketValue 又没有实时净值时返回 0
}

export function totalProfit(h: Pick<Holding, "marketValue" | "totalProfit" | "shares" | "costPrice">): number {
  if (typeof h.totalProfit === "number") return h.totalProfit;
  if (typeof h.marketValue === "number" && h.shares > 0 && h.costPrice > 0) {
    return h.marketValue - h.shares * h.costPrice;
  }
  return 0;
}

export function todayProfit(h: Pick<Holding, "todayProfit">): number {
  return typeof h.todayProfit === "number" ? h.todayProfit : 0;
}

export function totalProfitRate(h: Holding): number {
  if (typeof h.totalProfitRate === "number") return h.totalProfitRate;
  // 派生：累计收益 / 成本总额 * 100
  const tp = totalProfit(h);
  const cost = (h.marketValue ?? 0) - tp;
  return cost > 0 ? (tp / cost) * 100 : 0;
}

// 持仓天数（含买入当天，最小为 1）
export function holdingDays(startDate: string, today = new Date()) {
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return 0;
  const diff = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  return Math.max(diff + 1, 1);
}

// ── 通用工具函数 ──
export function formatMoney(n: number) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPrice(n: number) {
  return n.toFixed(4);
}

export function formatPercent(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function profitColor(val: number) {
  if (val > 0) return "text-red-500";
  if (val < 0) return "text-green-500";
  return "text-gray-500";
}

export function profitSign(val: number) {
  return val > 0 ? "+" : "";
}

export function channelMeta(channel: Channel) {
  switch (channel) {
    case "alipay":
      return { label: "支付宝", icon: "🅰️", badge: "bg-blue-50 text-blue-600", bar: "bg-blue-500", dot: "bg-blue-500" };
    case "cmb":
      return { label: "招商银行", icon: "🏦", badge: "bg-red-50 text-red-600", bar: "bg-red-500", dot: "bg-red-500" };
  }
}

// ────────────────────────────────────────────────────────────
// 每日快照（用于趋势线/记录）
// ────────────────────────────────────────────────────────────

export interface DailySnapshot {
  date: string; // YYYY-MM-DD（同一天多次刷新只保留最新一条）
  timestamp: number;
  totalAssets: number;
  todayProfit: number;
  totalProfit: number;
  byChannel: Partial<Record<Channel, { assets: number; todayProfit: number; count: number }>>;
}

// ────────────────────────────────────────────────────────────
// 兼容 API 路由的类型（/api/fund-quote、/api/parse-fund）
// ────────────────────────────────────────────────────────────

export interface FundQuote {
  code: string;
  name: string;
  navDate: string;
  dwjz: number;
  gsz: number;
  gszzl: number;
  gztime: string;
}

/**
 * AI 解析返回的单只基金（截图直接抓取的所有字段）
 * 兼容字段 value/profit/rate 仍保留（= marketValue/totalProfit/totalProfitRate 别名）
 */
export interface FundHolding {
  name: string;
  code: string;
  marketValue: number; // 持有金额（市值）
  totalProfit: number; // 累计收益（元）
  totalProfitRate: number; // 累计收益率 %
  todayProfit: number; // 今日收益（元）
  todayRate: number; // 今日涨幅 %
  shares: number; // 持有份额（详情页才有）
  costPrice: number; // 成本净值（详情页才有）
  // 向后兼容别名
  value?: number;
  profit?: number;
  rate?: number;
  // 名称反查校验
  verifyStatus?: "matched" | "corrected" | "unverified";
  searchedName?: string;
}

export interface ParsedFundData {
  platform?: Channel; // AI 自动识别的渠道（支付宝/招行）
  totalAssets: number;
  todayProfit: number;
  holdings: FundHolding[];
}
