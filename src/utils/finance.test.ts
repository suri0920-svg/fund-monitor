/**
 * calculateFundProfit 测试用例
 *
 * 运行方式（项目无测试框架，用 Node 内置 node:test + npx tsx 按需下载）：
 *   npx --yes tsx --test src/utils/finance.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFundProfit,
  CONSERVATIVE_STRATEGY,
  type PositionData,
  type QuoteData,
} from "./finance";

const basePosition: PositionData = {
  costPrice: 1,
  holdingShares: 1000,
  platform: "alipay",
};

const baseQuote: QuoteData = {
  dwjz: 1,
  gsz: 1,
};

// 浮点比较：JS 中 1000 × 0.02 = 20.000000000000004，用近似相等避免噪声
const approx = (actual: number, expected: number, eps = 1e-6) =>
  Math.abs(actual - expected) < eps;

describe("基本收益计算", () => {
  it("今日收益 = 份额 × (gsz - dwjz)", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000 },
      { dwjz: 1.1, gsz: 1.12 },
    );
    // 1000 × (1.12 - 1.10) = 20
    assert.ok(approx(r.todayProfit, 20));
    // 市值 = 1000 × 1.12 = 1120
    assert.ok(approx(r.marketValue, 1120));
  });

  it("今日下跌时收益为负", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 500 },
      { dwjz: 1.2, gsz: 1.18 },
    );
    // 500 × (1.18 - 1.20) = -10
    assert.ok(approx(r.todayProfit, -10));
    assert.ok(approx(r.marketValue, 590));
  });

  it("累计收益率 = (市值 - 成本) / 成本", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000 },
      { dwjz: 1.1, gsz: 1.2 },
    );
    // 成本 1000，市值 1200，累计 200 / 1000 = 0.2
    assert.ok(approx(r.totalProfit, 200));
    assert.ok(approx(r.totalProfitRate, 0.2));
  });
});

describe("默认 peakNav 行为", () => {
  it("未传 peakNav 且 gsz ≥ costPrice 时取 gsz，回撤恒为 0", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000 },
      { dwjz: 1.1, gsz: 1.12 },
    );
    assert.equal(r.peakNav, 1.12);
    assert.equal(r.drawdownFromPeak, 0);
  });

  it("未传 peakNav 且 gsz < costPrice 时取 costPrice，drawdown 反映从成本价的下跌", () => {
    // 反映"买入即亏"的真实情况：成本价即为历史最高，从成本价下跌 = 从最高净值回撤
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1.1, holdingShares: 1000 },
      { dwjz: 1.05, gsz: 1.0 },
    );
    // peakNav = max(1.1, 1.0) = 1.1，drawdown = (1.1 - 1.0)/1.1 ≈ 0.0909
    assert.equal(r.peakNav, 1.1);
    assert.ok(approx(r.drawdownFromPeak, (1.1 - 1.0) / 1.1));
    // 9.09% ≥ 2.5%，触发建议止损
    assert.equal(r.status, "建议止损");
  });
});

describe("策略状态判断", () => {
  it("正常持有：盈利中但未达 15% 目标", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.12 },
      { dwjz: 1.1, gsz: 1.12 },
    );
    // peakRate = 12% < 15%，drawdown = 0
    assert.equal(r.hitTarget, false);
    assert.equal(r.status, "正常持有");
  });

  it("建议止损：未达目标，从峰值回撤 ≥2.5%", () => {
    // cost=1.0，peak=1.05（peakRate=5%，未达 15%），gsz=1.02（回撤 2.857%）
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.05 },
      { dwjz: 1.05, gsz: 1.02 },
    );
    assert.equal(r.hitTarget, false);
    assert.ok(r.drawdownFromPeak >= 0.025);
    assert.equal(r.status, "建议止损");
  });

  it("移动止盈触发：达 15% 后从峰值回落 ≥3%", () => {
    // cost=1.0，peak=1.20（peakRate=20% ≥ 15%），gsz=1.16（回撤 3.33%）
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.2, gsz: 1.16 },
    );
    assert.equal(r.hitTarget, true);
    assert.ok(r.drawdownFromPeak >= 0.03);
    assert.equal(r.status, "移动止盈触发");
  });

  it("达目标但未回落：继续持有", () => {
    // cost=1.0，peak=gsz=1.20（peakRate=20%，drawdown=0）
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.18, gsz: 1.2 },
    );
    assert.equal(r.hitTarget, true);
    assert.equal(r.drawdownFromPeak, 0);
    assert.equal(r.status, "正常持有");
  });

  it("达目标后小幅回落但未到 3%：继续持有", () => {
    // cost=1.0，peak=1.20，gsz=1.18（回落 1.67% < 3%）
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.2, gsz: 1.18 },
    );
    assert.equal(r.hitTarget, true);
    assert.ok(r.drawdownFromPeak < 0.03);
    assert.equal(r.status, "正常持有");
  });

  it("达目标后回落介于 2.5% 与 3% 之间：仍正常持有（不触发止损也不触发止盈）", () => {
    // cost=1.0，peak=1.20（达目标），gsz=1.17（回落 2.5%，未到 3%）
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.2, gsz: 1.17 },
    );
    // drawdown = (1.20 - 1.17) / 1.20 = 0.025
    assert.equal(r.hitTarget, true);
    assert.ok(r.drawdownFromPeak >= 0.025 && r.drawdownFromPeak < 0.03);
    // 已达目标 → 走止盈分支（阈值 3%），不触发
    assert.equal(r.status, "正常持有");
  });
});

describe("自定义策略", () => {
  it("更激进的策略能更早触发止盈", () => {
    // 默认策略下不触发（回落 2% < 3%）
    const r1 = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.2, gsz: 1.176 },
    );
    assert.equal(r1.status, "正常持有");

    // 自定义：达 10% 即观察，回落 1.5% 即止盈
    const r2 = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.2, gsz: 1.176 },
      { targetProfitRate: 0.1, takeProfitDrawdown: 0.015, stopLossDrawdown: 0.02 },
    );
    // peakRate 20% ≥ 10%，drawdown 2% ≥ 1.5%
    assert.equal(r2.hitTarget, true);
    assert.equal(r2.status, "移动止盈触发");
  });
});

describe("渠道字段不影响计算", () => {
  it("alipay 与 cmb 同入参结果一致", () => {
    const mk = (platform: "alipay" | "cmb") =>
      calculateFundProfit(
        { costPrice: 1, holdingShares: 1000, platform, peakNav: 1.2 },
        { dwjz: 1.1, gsz: 1.2 },
      );
    const a = mk("alipay");
    const c = mk("cmb");
    assert.equal(a.todayProfit, c.todayProfit);
    assert.equal(a.marketValue, c.marketValue);
    assert.equal(a.status, c.status);
  });
});

describe("边界情况", () => {
  it("零份额：所有金额为 0，状态正常持有", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 0, peakNav: 1.1 },
      { dwjz: 1, gsz: 1.1 },
    );
    assert.equal(r.todayProfit, 0);
    assert.equal(r.marketValue, 0);
    assert.equal(r.totalProfit, 0);
    assert.equal(r.totalProfitRate, 0);
    assert.equal(r.status, "正常持有");
  });

  it("零成本价：避免除零，totalProfitRate 兜底为 0", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 0, holdingShares: 1000, peakNav: 1.2 },
      { dwjz: 1.1, gsz: 1.2 },
    );
    assert.equal(r.totalProfitRate, 0);
    assert.equal(r.hitTarget, false);
  });

  it("peakNav ≤ 0 时退回 max(costPrice, gsz)", () => {
    const r = calculateFundProfit(
      { ...basePosition, costPrice: 1, holdingShares: 1000, peakNav: 0 },
      { dwjz: 1.1, gsz: 1.2 },
    );
    assert.equal(r.peakNav, 1.2);
    assert.equal(r.drawdownFromPeak, 0);
  });
});

describe("策略常量", () => {
  it("默认稳健型策略值符合预期", () => {
    assert.deepEqual(CONSERVATIVE_STRATEGY, {
      targetProfitRate: 0.15,
      takeProfitDrawdown: 0.03,
      stopLossDrawdown: 0.025,
    });
  });
});
