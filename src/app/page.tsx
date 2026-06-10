"use client";

import { useState, useEffect, useCallback } from "react";
import ValuationDashboard from "@/components/ValuationDashboard";
import ScreenshotImport from "@/components/ScreenshotImport";
import type { Holding, DailySnapshot } from "@/lib/types";
import { mockHoldings, mockSnapshots } from "@/lib/mock-data";

type Tab = "dashboard" | "import";

const SNAP_KEY = "fund-monitor:snapshots-v1";

export default function Home() {
  const [holdings, setHoldings] = useState<Holding[]>(mockHoldings);
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>(mockSnapshots);
  const [tab, setTab] = useState<Tab>("dashboard");

  // ── 加载历史快照（mock + localStorage 真实快照合并）──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SNAP_KEY);
      if (raw) {
        const saved: DailySnapshot[] = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length) {
          // 把 mock 的最早一天替换成真实历史
          const mockDates = new Set(mockSnapshots.map((s) => s.date));
          const real = saved.filter((s) => !mockDates.has(s.date));
          const merged = [...mockSnapshots, ...real].sort((a, b) => a.timestamp - b.timestamp);
          setSnapshots(merged.slice(-90)); // 最多保留 90 天
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // ── 记录当日快照（每次 holdings 变化时更新今天那一条）──
  const recordSnapshot = useCallback((next: Holding[]) => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const totalAssets = next.reduce((s, h) => s + (h.marketValue ?? 0), 0);
    const todayProfit = next.reduce((s, h) => s + (h.todayProfit ?? 0), 0);
    const totalProfit = next.reduce((s, h) => s + (h.totalProfit ?? 0), 0);
    const byChannel: DailySnapshot["byChannel"] = {};
    for (const ch of ["alipay", "cmb"] as const) {
      const items = next.filter((h) => h.channel === ch);
      if (items.length) {
        byChannel[ch] = {
          assets: items.reduce((s, h) => s + (h.marketValue ?? 0), 0),
          todayProfit: items.reduce((s, h) => s + (h.todayProfit ?? 0), 0),
          count: items.length,
        };
      }
    }
    const snap: DailySnapshot = {
      date: dateStr,
      timestamp: today.getTime(),
      totalAssets,
      todayProfit,
      totalProfit,
      byChannel,
    };
    setSnapshots((prev) => {
      const withoutToday = prev.filter((s) => s.date !== dateStr);
      const nextList = [...withoutToday, snap].sort((a, b) => a.timestamp - b.timestamp).slice(-90);
      try {
        localStorage.setItem(SNAP_KEY, JSON.stringify(nextList));
      } catch {
        // ignore
      }
      return nextList;
    });
  }, []);

  // ── handlers ──
  const handleConfirm = useCallback(
    (next: Holding[]) => {
      setHoldings(next);
      recordSnapshot(next);
      setTab("dashboard");
    },
    [recordSnapshot],
  );

  const handleEditHolding = useCallback(
    (id: string, patch: Partial<Holding>) => {
      setHoldings((prev) => {
        const next = prev.map((h) => (h.id === id ? { ...h, ...patch } : h));
        recordSnapshot(next);
        return next;
      });
    },
    [recordSnapshot],
  );

  const handleRemoveHolding = useCallback(
    (id: string) => {
      setHoldings((prev) => {
        const next = prev.filter((h) => h.id !== id);
        recordSnapshot(next);
        return next;
      });
    },
    [recordSnapshot],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center px-4">
          <h1 className="text-lg font-bold tracking-tight text-gray-900">
            <span className="text-indigo-600">Fund</span> Monitor
          </h1>
          <span className="ml-2 text-xs text-gray-400">数据监控 · 持仓管理</span>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 px-4">
          <TabButton
            active={tab === "dashboard"}
            onClick={() => setTab("dashboard")}
            label="📈 每日估值大盘"
            sub={`${holdings.length} 只`}
          />
          <TabButton
            active={tab === "import"}
            onClick={() => setTab("import")}
            label="📸 截图导入 & 持仓管理"
          />
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {tab === "dashboard" ? (
          <ValuationDashboard holdings={holdings} snapshots={snapshots} />
        ) : (
          <ScreenshotImport
            onConfirm={handleConfirm}
            onEditHolding={handleEditHolding}
            onRemoveHolding={handleRemoveHolding}
            holdings={holdings}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
        active ? "text-indigo-600 font-bold" : "text-gray-500 font-medium hover:text-gray-800"
      }`}
    >
      <span>{label}</span>
      {sub && (
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${active ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500"}`}>
          {sub}
        </span>
      )}
      <span
        className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-full transition-all ${active ? "bg-indigo-600 opacity-100" : "opacity-0"}`}
      />
    </button>
  );
}
