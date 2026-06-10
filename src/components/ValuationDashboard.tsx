"use client";

import {
  type Holding,
  type Channel,
  type DailySnapshot,
  marketValue,
  todayProfit,
  totalProfit,
  totalProfitRate,
  holdingDays,
  formatMoney,
  formatPercent,
  profitColor,
  profitSign,
  channelMeta,
} from "@/lib/types";

interface ValuationDashboardProps {
  holdings: Holding[];
  snapshots?: DailySnapshot[];
}

const CHANNEL_ORDER: Channel[] = ["alipay", "cmb"];

export default function ValuationDashboard({ holdings, snapshots = [] }: ValuationDashboardProps) {
  // ── 汇总 ──
  const totalAssets = holdings.reduce((s, h) => s + marketValue(h), 0);
  const todayTotal = holdings.reduce((s, h) => s + todayProfit(h), 0);
  const totalCumulative = holdings.reduce((s, h) => s + totalProfit(h), 0);
  const costBasis = totalAssets - totalCumulative;
  const totalCumulativeRate = costBasis > 0 ? (totalCumulative / costBasis) * 100 : 0;

  // ── 按渠道分组 ──
  const grouped = CHANNEL_ORDER.map((channel) => {
    const items = holdings.filter((h) => h.channel === channel);
    const assets = items.reduce((s, h) => s + marketValue(h), 0);
    return { channel, items, assets };
  }).filter((g) => g.items.length > 0);

  if (holdings.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-8 text-center text-white shadow-xl shadow-indigo-500/20">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />
        <p className="text-lg font-semibold text-indigo-100">暂无持仓数据</p>
        <p className="mt-2 text-sm text-indigo-200/70">
          切换到「截图导入管理」上传持仓截图，AI 会自动识别并填入表格
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 顶部主汇总卡（参考天天基金/雪球基金的总览卡）── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-6 text-white shadow-xl shadow-indigo-500/20">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-sm font-medium text-indigo-100">总资产（估算市值）</p>
          <p className="mt-2 text-4xl font-bold tracking-tight">¥{formatMoney(totalAssets)}</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCell
              label="今日收益"
              value={todayTotal}
              sub={`${profitSign(todayTotal / Math.max(totalAssets, 1) * 100)}${(todayTotal / Math.max(totalAssets, 1) * 100).toFixed(2)}%`}
            />
            <MetricCell
              label="累计收益"
              value={totalCumulative}
              sub={`${profitSign(totalCumulativeRate)}${totalCumulativeRate.toFixed(2)}%`}
            />
            <MetricCell label="持仓基金" value={null} customValue={`${holdings.length} 只`} sub={`${grouped.length} 个平台`} />
            <MetricCell
              label="成本总额"
              value={null}
              customValue={`¥${formatMoney(costBasis)}`}
              sub="购入基准"
              neutral
            />
          </div>
        </div>
      </div>

      {/* ── 趋势线（总资产 + 今日收益）── */}
      {snapshots.length >= 2 && (
        <TrendCard snapshots={snapshots} />
      )}

      {/* ── 平台分组进度 ── */}
      {grouped.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {grouped.map((g) => {
            const meta = channelMeta(g.channel);
            const ratio = totalAssets > 0 ? (g.assets / totalAssets) * 100 : 0;
            const groupToday = g.items.reduce((s, h) => s + todayProfit(h), 0);
            const groupTotal = g.items.reduce((s, h) => s + totalProfit(h), 0);
            return (
              <div key={g.channel} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <span>{meta.icon}</span>
                  <span className="text-sm font-semibold text-gray-800">{meta.label}</span>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.badge}`}>{g.items.length} 只</span>
                  <span className="ml-auto text-sm font-semibold text-gray-900">¥{formatMoney(g.assets)}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div className={`h-full rounded-full ${meta.bar} transition-all duration-500`} style={{ width: `${ratio}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-gray-400">占比 {ratio.toFixed(1)}%</span>
                  <span className="flex gap-3">
                    <span className={profitColor(groupToday)}>今日 {profitSign(groupToday)}¥{formatMoney(Math.abs(groupToday))}</span>
                    <span className={profitColor(groupTotal)}>累计 {profitSign(groupTotal)}¥{formatMoney(Math.abs(groupTotal))}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 持仓明细表格 ── */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-gray-900">持仓明细</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50/80 text-left text-xs text-gray-500">
                <Th>基金名称</Th>
                <Th>渠道</Th>
                <Th className="text-right">持有金额</Th>
                <Th className="text-right">持有份额</Th>
                <Th className="text-right">成本净值</Th>
                <Th className="text-right">今日涨幅</Th>
                <Th className="text-right">今日收益</Th>
                <Th className="text-right">累计收益</Th>
                <Th className="text-right">累计收益率</Th>
                <Th className="text-right">持仓天数</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {holdings.map((h) => {
                const mv = marketValue(h);
                const tp = todayProfit(h);
                const cp = totalProfit(h);
                const cpr = totalProfitRate(h);
                const days = holdingDays(h.startDate);
                return (
                  <tr key={h.id} className="transition-colors hover:bg-indigo-50/40">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-gray-900">{h.name}</p>
                      <p className="mt-0.5 text-xs text-gray-400">{h.code}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${channelMeta(h.channel).badge}`}>
                        {channelMeta(h.channel).label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums font-medium text-gray-900">¥{formatMoney(mv)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-700">
                      {h.shares > 0 ? formatMoney(h.shares) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-500">
                      {h.costPrice > 0 ? h.costPrice.toFixed(4) : "—"}
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${profitColor(h.todayRate ?? 0)}`}>
                      {typeof h.todayRate === "number" ? formatPercent(h.todayRate) : "—"}
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums ${profitColor(tp)}`}>
                      {profitSign(tp)}¥{formatMoney(Math.abs(tp))}
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums ${profitColor(cp)}`}>
                      {profitSign(cp)}¥{formatMoney(Math.abs(cp))}
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${profitColor(cpr)}`}>
                      {formatPercent(cpr)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-500">{days} 天</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100 bg-gray-50/60 text-xs text-gray-600">
                <td className="px-5 py-3 font-semibold" colSpan={2}>合计（{holdings.length} 只）</td>
                <td className="px-5 py-3 text-right font-semibold text-gray-900">¥{formatMoney(totalAssets)}</td>
                <td className="px-5 py-3 text-right text-gray-400">—</td>
                <td className="px-5 py-3 text-right text-gray-400">—</td>
                <td className="px-5 py-3 text-right text-gray-400">—</td>
                <td className={`px-5 py-3 text-right font-semibold ${profitColor(todayTotal)}`}>
                  {profitSign(todayTotal)}¥{formatMoney(Math.abs(todayTotal))}
                </td>
                <td className={`px-5 py-3 text-right font-semibold ${profitColor(totalCumulative)}`}>
                  {profitSign(totalCumulative)}¥{formatMoney(Math.abs(totalCumulative))}
                </td>
                <td className={`px-5 py-3 text-right font-semibold ${profitColor(totalCumulativeRate)}`}>
                  {formatPercent(totalCumulativeRate)}
                </td>
                <td className="px-5 py-3 text-right text-gray-400">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 顶部主汇总卡里的指标小格 ──
function MetricCell({
  label,
  value,
  customValue,
  sub,
  neutral = false,
}: {
  label: string;
  value: number | null;
  customValue?: string;
  sub?: string;
  neutral?: boolean;
}) {
  const color = value === null || neutral ? "text-white" : value >= 0 ? "text-red-300" : "text-green-300";
  const display = customValue ?? (value === null ? "" : `${profitSign(value)}¥${formatMoney(Math.abs(value))}`);
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2.5">
      <p className="text-[11px] text-indigo-100">{label}</p>
      <p className={`mt-1 text-lg font-bold tracking-tight tabular-nums ${color}`}>{display}</p>
      {sub && <p className={`mt-0.5 text-[10px] tabular-nums ${color} opacity-80`}>{sub}</p>}
    </div>
  );
}

// ── 趋势线卡（纯 SVG，避免引入图表库）──
function TrendCard({ snapshots }: { snapshots: DailySnapshot[] }) {
  const W = 800;
  const H = 160;
  const PAD = 28;
  const assets = snapshots.map((s) => s.totalAssets);
  const min = Math.min(...assets);
  const max = Math.max(...assets);
  const range = max - min || 1;
  const stepX = (W - PAD * 2) / Math.max(snapshots.length - 1, 1);

  const points = snapshots.map((s, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((s.totalAssets - min) / range) * (H - PAD * 2);
    return { x, y, ...s };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1].x.toFixed(1)} ${H - PAD} L${points[0].x.toFixed(1)} ${H - PAD} Z`;

  const todayChange = snapshots.length >= 2 ? snapshots[snapshots.length - 1].totalAssets - snapshots[snapshots.length - 2].totalAssets : 0;
  const periodChange = snapshots.length >= 2 ? snapshots[snapshots.length - 1].totalAssets - snapshots[0].totalAssets : 0;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">总资产趋势</h3>
          <p className="text-xs text-gray-400">最近 {snapshots.length} 天 · 每日自动快照</p>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-[11px] text-gray-400">较昨日</p>
            <p className={`text-sm font-semibold tabular-nums ${profitColor(todayChange)}`}>
              {profitSign(todayChange)}¥{formatMoney(Math.abs(todayChange))}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-gray-400">区间变动</p>
            <p className={`text-sm font-semibold tabular-nums ${profitColor(periodChange)}`}>
              {profitSign(periodChange)}¥{formatMoney(Math.abs(periodChange))}
            </p>
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 网格 */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={PAD} x2={W - PAD} y1={PAD + r * (H - PAD * 2)} y2={PAD + r * (H - PAD * 2)} stroke="rgb(243 244 246)" strokeWidth="1" />
        ))}
        {/* 区域填充 */}
        <path d={areaD} fill="url(#trendGradient)" />
        {/* 曲线 */}
        <path d={pathD} fill="none" stroke="rgb(99 102 241)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* 数据点 */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 2.5} fill="rgb(99 102 241)" />
        ))}
        {/* 极值标签 */}
        <text x={PAD} y={PAD - 6} fontSize="10" fill="rgb(156 163 175)">¥{formatMoney(max)}</text>
        <text x={PAD} y={H - PAD + 14} fontSize="10" fill="rgb(156 163 175)">¥{formatMoney(min)}</text>
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{snapshots[0].date}</span>
        <span>{snapshots[snapshots.length - 1].date}</span>
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-2.5 font-medium whitespace-nowrap ${className}`}>{children}</th>;
}
