"use client";

import { useState, useRef, useCallback } from "react";
import {
  type Holding,
  type DraftHolding,
  type Channel,
  type ParsedFundData,
  channelMeta,
  formatMoney,
  formatPercent,
  profitColor,
} from "@/lib/types";
import { mockParsedDrafts } from "@/lib/mock-data";

interface ScreenshotImportProps {
  /** 确认导入：合并入 holdings 后由父组件 setState */
  onConfirm: (newHoldings: Holding[]) => void;
  /** 编辑已有持仓 */
  onEditHolding: (id: string, patch: Partial<Holding>) => void;
  /** 删除已有持仓 */
  onRemoveHolding: (id: string) => void;
  /** 已存在的持仓列表（静态资产基准数据） */
  holdings: Holding[];
}

type FileStatus = "pending" | "parsing" | "done" | "error";

interface UploadItem {
  id: string;
  file: File;
  preview: string;
  status: FileStatus;
  errorMsg?: string;
  detectedChannel?: Channel;
}

const inputCls =
  "w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400";
const inputRightCls = `${inputCls} text-right tabular-nums`;

export default function ScreenshotImport({
  onConfirm,
  onEditHolding,
  onRemoveHolding,
  holdings,
}: ScreenshotImportProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [drafts, setDrafts] = useState<DraftHolding[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── 文件管理 ──
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    const mapped: UploadItem[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      status: "pending" as const,
    }));
    setItems((prev) => [...prev, ...mapped]);
    // 添加后立即开始解析
    setTimeout(() => mapped.forEach((m) => parseImage(m)), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  // ── AI 解析 ──
  const parseImage = useCallback(
    async (item: UploadItem) => {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "parsing" as const } : i)));
      setParsing(true);
      try {
        const formData = new FormData();
        formData.append("image", item.file);
        formData.append("platform", "alipay"); // 仅作 fallback，真正由 AI 识别

        const res = await fetch("/api/parse-fund", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "解析失败");

        const data: ParsedFundData = json.data;
        const detected = data.platform ?? "alipay";
        const incoming: DraftHolding[] = (data.holdings || [])
          .filter((h) => h.code)
          .map((h, idx) => ({
            id: `${item.id}-${idx}-${h.code}`,
            name: h.name,
            code: h.code,
            shares: h.shares || 0,
            costPrice: h.costPrice || 0,
            channel: detected,
            marketValue: h.marketValue || 0,
            totalProfit: h.totalProfit || 0,
            totalProfitRate: h.totalProfitRate || 0,
            todayProfit: h.todayProfit || 0,
            todayRate: h.todayRate || 0,
            verifyStatus: h.verifyStatus,
            searchedName: h.searchedName,
          }));

        // 同图覆盖 / 跨图按 code+name 去重
        setDrafts((prev) => {
          const withoutThisItem = prev.filter((d) => !d.id.startsWith(`${item.id}-`));
          const seenCodes = new Set(withoutThisItem.map((d) => d.code).filter((c) => c.trim().length > 0));
          const seenNames = new Set(withoutThisItem.map((d) => d.name.trim()).filter((n) => n.length > 0));
          const fresh = incoming.filter(
            (d) => !seenCodes.has(d.code) && !seenNames.has(d.name.trim()),
          );
          return [...withoutThisItem, ...fresh];
        });
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "done" as const, detectedChannel: detected } : i)),
        );

        const stats = json.meta?.stats;
        const statsText = stats ? ` · ✓${stats.matched} ⚠${stats.corrected} ?${stats.unverified}` : "";
        flashToast(`解析出 ${incoming.length} 只（${detected === "cmb" ? "招商银行" : "支付宝"}）${statsText}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "未知错误";
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "error" as const, errorMsg: msg } : i)));
      } finally {
        setParsing(false);
      }
    },
    [],
  );

  // ── 模拟解析（演示用）──
  const simulateParse = useCallback(() => {
    setParsing(true);
    setTimeout(() => {
      setDrafts((prev) => {
        const existingIds = new Set(prev.map((d) => d.id));
        const fresh = mockParsedDrafts.filter((d) => !existingIds.has(d.id));
        return [...prev, ...fresh];
      });
      setParsing(false);
      flashToast("已模拟解析 2 只基金，请在下方校正");
    }, 600);
  }, []);

  // ── 编辑 draft ──
  const updateDraft = useCallback((id: string, patch: Partial<DraftHolding>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);
  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // ── 确认导入 ──
  const handleConfirm = useCallback(() => {
    const valid = drafts.filter((d) => d.code && (d.shares > 0 || d.marketValue > 0));
    if (!valid.length) {
      flashToast("没有可导入的有效基金，请检查代码与份额/市值");
      return;
    }
    setImporting(true);
    const today = new Date().toISOString().slice(0, 10);
    const incomingCodes = new Set(valid.map((d) => d.code));
    const kept = holdings.filter((h) => !incomingCodes.has(h.code));
    const synthesized: Holding[] = valid.map((d) => ({
      id: `h-${d.code}`,
      code: d.code,
      name: d.name || `基金 ${d.code}`,
      channel: d.channel,
      shares: d.shares,
      costPrice: d.costPrice,
      startDate: today,
      marketValue: d.marketValue,
      totalProfit: d.totalProfit,
      totalProfitRate: d.totalProfitRate,
      todayProfit: d.todayProfit,
      todayRate: d.todayRate,
    }));
    const next = [...kept, ...synthesized];
    onConfirm(next);
    setDrafts([]);
    setItems((prev) => prev.filter((i) => i.status !== "done"));
    setImporting(false);
    flashToast(`成功导入 ${synthesized.length} 只基金`);
  }, [drafts, holdings, onConfirm]);

  // ── 已有持仓编辑/删除 ──
  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const saveEdit = useCallback(
    (id: string, patch: Partial<Holding>) => {
      onEditHolding(id, patch);
      setEditingId(null);
      flashToast("已保存修改");
    },
    [onEditHolding],
  );

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  // ── 拖拽 ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const existingCodes = new Set(holdings.map((h) => h.code));

  return (
    <div className="space-y-6">
      {/* ───── 1. 多模态导入区域 ───── */}
      <section>
        <SectionHeader index={1} title="AI 截图导入" desc="拖入支付宝或招行的持仓截图，AI 自动识别基金和字段" />
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed
            px-6 py-12 cursor-pointer transition-all duration-200
            ${dragging
              ? "border-indigo-500 bg-indigo-50 scale-[1.01]"
              : "border-gray-200 bg-gray-50/50 hover:border-indigo-400 hover:bg-indigo-50/40"}
          `}
        >
          <div className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${dragging ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-400"}`}>
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">
              {dragging ? "松开即可上传" : "拖拽基金持仓截图到此处"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              或 <span className="text-indigo-500 font-medium">点击选择文件</span> · 支持 JPG / PNG · 多张可批量
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* 模拟解析按钮（演示用）+ 上传项状态 */}
        {(items.length > 0 || parsing) && (
          <div className="mt-3 space-y-2.5">
            {parsing && items.every((i) => i.status === "parsing") && (
              <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-xs text-indigo-700">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                AI 正在解析中… 识别基金名称、代码、份额、成本、收益等
              </div>
            )}
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <img src={item.preview} alt={item.file.name} className="h-16 w-16 rounded-lg object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {item.detectedChannel && (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${channelMeta(item.detectedChannel).badge}`}>
                        {channelMeta(item.detectedChannel).icon} {channelMeta(item.detectedChannel).label}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 truncate">{item.file.name}</span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="ml-auto shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                      aria-label="删除"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="mt-2">
                    {item.status === "pending" && <span className="text-xs text-gray-400">等待解析…</span>}
                    {item.status === "parsing" && (
                      <span className="flex items-center gap-1.5 text-xs text-indigo-600">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        AI 正在识别…
                      </span>
                    )}
                    {item.status === "done" && (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        解析完成，下方校正
                      </span>
                    )}
                    {item.status === "error" && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-500">{item.errorMsg}</span>
                        <button
                          onClick={() => parseImage(item)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                        >
                          重试
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 没有上传时显示模拟解析按钮 */}
        {items.length === 0 && !parsing && (
          <button
            onClick={simulateParse}
            className="mt-3 rounded-lg bg-amber-100 px-3.5 py-2 text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
          >
            ✨ 模拟解析（演示，无需上传）
          </button>
        )}
      </section>

      {/* ───── 2. 解析确认表单 ───── */}
      {drafts.length > 0 && (
        <section>
          <SectionHeader
            index={2}
            title="解析结果校正"
            desc="AI 已自动填入字段，请人工核对后确认导入"
          />
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">共 {drafts.length} 只待导入</h3>
                <p className="mt-0.5 text-xs text-gray-400">
                  名称反查自动校验代码 · 列表页字段（金额/收益）已自动填入
                </p>
              </div>
              <button onClick={() => setDrafts([])} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                清空
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {drafts.map((d) => {
                const meta = channelMeta(d.channel);
                const duplicated = existingCodes.has(d.code);
                return (
                  <div key={d.id} className="p-4 hover:bg-gray-50/60 transition-colors">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                      <Field label="基金名称" className="col-span-2 sm:col-span-4">
                        <input value={d.name} onChange={(e) => updateDraft(d.id, { name: e.target.value })} className={inputCls} />
                      </Field>
                      <Field label="基金代码" className="col-span-1 sm:col-span-2">
                        <input
                          value={d.code}
                          onChange={(e) => updateDraft(d.id, { code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                          className={`${inputCls} ${duplicated ? "border-amber-400 bg-amber-50/40" : ""}`}
                        />
                        <VerifyBadge status={d.verifyStatus} searchedName={d.searchedName} />
                        {duplicated && <p className="mt-1 text-[10px] text-amber-600">已存在，导入将覆盖</p>}
                      </Field>
                      <Field label="渠道（自动识别）" className="col-span-1 sm:col-span-2">
                        <div className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs ${meta.badge}`}>
                          <span>{meta.icon}</span>
                          <select
                            value={d.channel}
                            onChange={(e) => updateDraft(d.id, { channel: e.target.value as Channel })}
                            className="bg-transparent text-xs font-medium focus:outline-none"
                          >
                            <option value="alipay">支付宝</option>
                            <option value="cmb">招商银行</option>
                          </select>
                        </div>
                      </Field>
                      <Field label="持有份额" className="col-span-1 sm:col-span-2">
                        <input
                          value={d.shares || ""}
                          onChange={(e) => updateDraft(d.id, { shares: parseFloat(e.target.value) || 0 })}
                          inputMode="decimal"
                          placeholder="0"
                          className={inputRightCls}
                        />
                      </Field>
                      <Field label="成本净值" className="col-span-1 sm:col-span-2">
                        <input
                          value={d.costPrice || ""}
                          onChange={(e) => updateDraft(d.id, { costPrice: parseFloat(e.target.value) || 0 })}
                          inputMode="decimal"
                          placeholder="0.0000"
                          className={inputRightCls}
                        />
                      </Field>

                      {/* 截图直接给的字段（折叠区） */}
                      <Field label="持有金额（市值）" className="col-span-1 sm:col-span-3">
                        <input
                          value={d.marketValue || ""}
                          onChange={(e) => updateDraft(d.id, { marketValue: parseFloat(e.target.value) || 0 })}
                          inputMode="decimal"
                          placeholder="0"
                          className={inputRightCls}
                        />
                      </Field>
                      <Field label="累计收益（元）" className="col-span-1 sm:col-span-3">
                        <input
                          value={d.totalProfit || ""}
                          onChange={(e) => updateDraft(d.id, { totalProfit: parseFloat(e.target.value) || 0 })}
                          inputMode="decimal"
                          placeholder="0"
                          className={inputRightCls}
                        />
                      </Field>
                      <Field label="累计收益率 %" className="col-span-1 sm:col-span-3">
                        <input
                          value={d.totalProfitRate || ""}
                          onChange={(e) => updateDraft(d.id, { totalProfitRate: parseFloat(e.target.value) || 0 })}
                          inputMode="decimal"
                          placeholder="0"
                          className={inputRightCls}
                        />
                      </Field>
                      <Field label="今日收益（元）" className="col-span-1 sm:col-span-3">
                        <input
                          value={d.todayProfit || ""}
                          onChange={(e) => updateDraft(d.id, { todayProfit: parseFloat(e.target.value) || 0 })}
                          inputMode="decimal"
                          placeholder="0"
                          className={inputRightCls}
                        />
                      </Field>

                      <div className="col-span-2 flex justify-end sm:col-span-12">
                        <button
                          onClick={() => removeDraft(d.id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                        >
                          移除这一只
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-3">
              <p className="text-xs text-gray-500">
                预计导入 <span className="font-semibold text-gray-900">{drafts.filter((d) => d.code && (d.shares > 0 || d.marketValue > 0)).length}</span> 只
                {drafts.some((d) => d.marketValue > 0) && (
                  <span className="ml-2 text-gray-400">
                    持有金额合计 ¥{formatMoney(drafts.reduce((s, d) => s + d.marketValue, 0))}
                  </span>
                )}
              </p>
              <button
                onClick={handleConfirm}
                disabled={importing || drafts.filter((d) => d.code && (d.shares > 0 || d.marketValue > 0)).length === 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {importing ? "导入中…" : "确认加入我的持仓 → 切到估值大盘"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ───── 3. 已有持仓列表管理 ───── */}
      <section>
        <SectionHeader
          index={3}
          title="我的持仓（静态资产基准）"
          desc={`${holdings.length} 只基金 · 可手动修改或删除 · 是数据监控的基准`}
        />
        {holdings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
            <p className="text-sm text-gray-500">还没有保存的持仓</p>
            <p className="mt-1 text-xs text-gray-400">上传截图或点「模拟解析」开始</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="divide-y divide-gray-50">
              {holdings.map((h) => (
                <HoldingRow
                  key={h.id}
                  holding={h}
                  editing={editingId === h.id}
                  onStartEdit={() => startEdit(h.id)}
                  onCancelEdit={cancelEdit}
                  onSave={(patch) => saveEdit(h.id, patch)}
                  onRemove={() => onRemoveHolding(h.id)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 已有持仓行（展示 + 内联编辑）
// ─────────────────────────────────────────────

function HoldingRow({
  holding,
  editing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  holding: Holding;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: Partial<Holding>) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<Holding>(holding);

  // 进入编辑模式时同步最新 holding
  const enterEdit = () => {
    setDraft(holding);
    onStartEdit();
  };

  if (!editing) {
    const meta = channelMeta(holding.channel);
    const mv = holding.marketValue ?? 0;
    const tp = holding.totalProfit ?? 0;
    return (
      <div className="group flex items-center justify-between px-5 py-3 hover:bg-gray-50/60 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-gray-900">{holding.name}</p>
            <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.badge}`}>
              {meta.icon} {meta.label}
            </span>
            {typeof holding.todayRate === "number" && (
              <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${profitColor(holding.todayRate).replace("text-", "bg-").replace("-500", "-50")} ${holding.todayRate >= 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                {formatPercent(holding.todayRate)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            {holding.code} · {holding.shares > 0 ? `${formatMoney(holding.shares)} 份` : "份额未填"}
            {holding.costPrice > 0 && ` · 成本 ${holding.costPrice.toFixed(4)}`}
          </p>
        </div>
        <div className="ml-4 shrink-0 text-right">
          {mv > 0 && <p className="text-sm font-semibold text-gray-900">¥{formatMoney(mv)}</p>}
          {tp !== 0 && (
            <p className={`mt-0.5 text-xs ${profitColor(tp)}`}>
              累计 {tp > 0 ? "+" : ""}¥{formatMoney(Math.abs(tp))}
              {typeof holding.totalProfitRate === "number" && (
                <span className="ml-1">({formatPercent(holding.totalProfitRate)})</span>
              )}
            </p>
          )}
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={enterEdit}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-indigo-600"
          >
            编辑
          </button>
          <button
            onClick={onRemove}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            删除
          </button>
        </div>
      </div>
    );
  }

  // 编辑模式
  return (
    <div className="bg-indigo-50/30 px-5 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
        <Field label="基金名称" className="col-span-2 sm:col-span-4">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
        </Field>
        <Field label="基金代码" className="col-span-1 sm:col-span-2">
          <input
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
            className={inputCls}
          />
        </Field>
        <Field label="渠道" className="col-span-1 sm:col-span-2">
          <select
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value as Channel })}
            className={inputCls}
          >
            <option value="alipay">支付宝</option>
            <option value="cmb">招商银行</option>
          </select>
        </Field>
        <Field label="持有份额" className="col-span-1 sm:col-span-2">
          <input
            value={draft.shares || ""}
            onChange={(e) => setDraft({ ...draft, shares: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="成本净值" className="col-span-1 sm:col-span-2">
          <input
            value={draft.costPrice || ""}
            onChange={(e) => setDraft({ ...draft, costPrice: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="持有金额" className="col-span-1 sm:col-span-2">
          <input
            value={draft.marketValue ?? ""}
            onChange={(e) => setDraft({ ...draft, marketValue: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="累计收益" className="col-span-1 sm:col-span-2">
          <input
            value={draft.totalProfit ?? ""}
            onChange={(e) => setDraft({ ...draft, totalProfit: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="累计收益率 %" className="col-span-1 sm:col-span-2">
          <input
            value={draft.totalProfitRate ?? ""}
            onChange={(e) => setDraft({ ...draft, totalProfitRate: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="今日收益" className="col-span-1 sm:col-span-2">
          <input
            value={draft.todayProfit ?? ""}
            onChange={(e) => setDraft({ ...draft, todayProfit: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="今日涨幅 %" className="col-span-1 sm:col-span-2">
          <input
            value={draft.todayRate ?? ""}
            onChange={(e) => setDraft({ ...draft, todayRate: parseFloat(e.target.value) || 0 })}
            inputMode="decimal"
            className={inputRightCls}
          />
        </Field>
        <Field label="首次购入日期" className="col-span-2 sm:col-span-4">
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancelEdit}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={() => onSave(draft)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 子组件
// ─────────────────────────────────────────────

function SectionHeader({ index, title, desc }: { index: number; title: string; desc: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
        {index}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-400">{desc}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function VerifyBadge({
  status,
  searchedName,
}: {
  status?: "matched" | "corrected" | "unverified";
  searchedName?: string;
}) {
  if (!status) return null;
  if (status === "matched") {
    return (
      <p className="mt-1 flex items-center gap-1 text-[10px] text-green-600">
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        名称反查匹配
      </p>
    );
  }
  if (status === "corrected") {
    return (
      <p className="mt-1 text-[10px] text-amber-600" title={searchedName}>
        ⚠ 已按名称搜索纠正代码{searchedName ? `（→ ${searchedName}）` : ""}
      </p>
    );
  }
  return <p className="mt-1 text-[10px] text-gray-400">? 名称搜索未匹配，请人工核对</p>;
}
