/**
 * 基金收益计算 + 稳健型策略状态判断
 *
 * 输入：
 *   - position: 本地持仓（costPrice 成本净值、holdingShares 份额、platform 渠道、peakNav 历史最高净值[可选]）
 *   - quote:    天天基金 API 实时数据（dwjz 昨收、gsz 当前估算净值）
 *
 * 策略（默认稳健型）：
 *   - 目标收益率 15%：累计收益率首次 ≥15% 进入"止盈观察期"
 *   - 移动止盈：进入观察期后，从历史最高净值回落 ≥3% 触发
 *   - 移动止损：未进入观察期时，从历史最高净值回撤 ≥2.5% 触发
 *
 * 状态判断优先级：
 *   1. 达过目标 && 回落≥止盈阈值   → "移动止盈触发"
 *   2. 未达目标 && 回撤≥止损阈值   → "建议止损"
 *   3. 其他                         → "正常持有"
 */

/** 持仓数据（本地存储） */
export interface PositionData {
  costPrice: number; // 成本净值（每份）
  holdingShares: number; // 持有份额
  platform: "alipay" | "cmb";
  /** 历史最高净值，用于移动止盈/止损。未传时取 max(costPrice, gsz)，此时回撤恒为 0 */
  peakNav?: number;
}

/** 天天基金 API 实时数据 */
export interface QuoteData {
  dwjz: number; // 昨日收盘净值
  gsz: number; // 今日估算净值（盘中实时）
  gszzl?: number; // 估算涨幅 %
  name?: string;
  code?: string;
}

/** 稳健型策略参数（可覆盖） */
export interface Strategy {
  targetProfitRate: number; // 目标累计收益率，0.15 = 15%
  takeProfitDrawdown: number; // 达到目标后，从最高净值回落多少触发止盈，0.03 = 3%
  stopLossDrawdown: number; // 从最高净值回撤多少触发止损，0.025 = 2.5%
}

/** 默认稳健型策略 */
export const CONSERVATIVE_STRATEGY: Strategy = {
  targetProfitRate: 0.15,
  takeProfitDrawdown: 0.03,
  stopLossDrawdown: 0.025,
};

export type FundStatus = "正常持有" | "建议止损" | "移动止盈触发";

export interface FinanceCalcResult {
  todayProfit: number; // 今日预计收益额（元）
  marketValue: number; // 当前总市值（元）
  totalProfit: number; // 累计收益额（元）
  totalProfitRate: number; // 累计总收益率（小数，0.15 = 15%）
  status: FundStatus; // 策略状态
  hitTarget: boolean; // 是否曾达到目标收益（按 peakNav 推算）
  drawdownFromPeak: number; // 从最高净值的回撤（正数，0.03 = 3%）
  peakNav: number; // 实际使用的最高净值
  strategy: Strategy; // 本次使用的策略参数
}

/**
 * 计算基金收益与策略状态
 *
 * @param position  持仓数据
 * @param quote     实时净值
 * @param strategy  策略参数（默认稳健型）
 */
export function calculateFundProfit(
  position: PositionData,
  quote: QuoteData,
  strategy: Strategy = CONSERVATIVE_STRATEGY,
): FinanceCalcResult {
  const { costPrice, holdingShares } = position;
  const { dwjz, gsz } = quote;

  // ── 基本面 ──
  const todayProfit = holdingShares * (gsz - dwjz);
  const marketValue = holdingShares * gsz;
  const costBasis = holdingShares * costPrice;
  const totalProfit = marketValue - costBasis;
  const totalProfitRate = costBasis > 0 ? totalProfit / costBasis : 0;

  // ── 最高净值（未传则取成本价与当前估值的高者，回撤恒为 0，安全默认）──
  const peakNav =
    typeof position.peakNav === "number" && position.peakNav > 0
      ? position.peakNav
      : Math.max(costPrice, gsz);
  const drawdownFromPeak = peakNav > 0 ? (peakNav - gsz) / peakNav : 0;

  // ── 是否曾达到目标：用 peakNav 推算历史峰值时点的累计收益率 ──
  const peakProfitRate = costPrice > 0 ? (peakNav - costPrice) / costPrice : 0;
  const hitTarget = peakProfitRate >= strategy.targetProfitRate;

  // ── 状态判断 ──
  let status: FundStatus = "正常持有";
  if (hitTarget) {
    if (drawdownFromPeak >= strategy.takeProfitDrawdown) {
      status = "移动止盈触发";
    }
  } else {
    if (drawdownFromPeak >= strategy.stopLossDrawdown) {
      status = "建议止损";
    }
  }

  return {
    todayProfit,
    marketValue,
    totalProfit,
    totalProfitRate,
    status,
    hitTarget,
    drawdownFromPeak,
    peakNav,
    strategy,
  };
}
