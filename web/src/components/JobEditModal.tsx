// 投递记录编辑框：新增/编辑一条 JobRecord，改状态，标注挂因。
// 状态切换走 appendStatus（写状态历史，不是直接改 status 字段）——
// 保持和 jd-insight 扩展的 pushStatus 同一套语义：只在状态真的变了才追加历史。
import { useState } from "react";
import type { DataSource, JobRecord, Status } from "../lib/types";
import { STATUS_CYCLE, FAIL_BUCKETS, isTerminal } from "../lib/funnel";
import { parseSalary, formatSalary } from "../lib/salary";

interface Props {
  source: DataSource;
  job: JobRecord | null; // null = 新增模式
  onClose: () => void;
  onSaved: () => void;
}

function newKey(): string {
  return "manual-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function JobEditModal({ source, job, onClose, onSaved }: Props) {
  const isNew = job == null;
  const [title, setTitle] = useState(job?.title || "");
  const [company, setCompany] = useState(job?.company || "");
  const [salary, setSalary] = useState(job?.salary || "");
  // 边打字边解析，结果直接显示在输入框下面。这不只是提示：
  // 薪资是这里唯一会被拿去排序和算分布的字段，"我以为它认出来了"是最坏的情况，
  // 所以认出来就把折算年薪显示出来，没认出来就明说原因。
  const sal = parseSalary(salary);
  const [tagline, setTagline] = useState(job?.tagline || "");
  const [status, setStatus] = useState<Status>(job?.status || "");
  const [failReason, setFailReason] = useState(job?.failReason || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const writable = source.kind === "supabase";

  /** 删除。确认框必须带岗位名和公司——这是不可逆操作，
   *  只写"确定删除吗"防不住看错行。 */
  async function handleDelete() {
    if (!job) return;
    const label = job.title || "这条";
    const co = job.company ? `（${job.company}）` : "";
    if (
      !window.confirm(
        `删除「${label}」${co}？\n\n` +
          "会从云端删掉这条记录和它的状态历史，并记一条删除标记，\n" +
          "这样 jd-insight 扩展下次同步不会把它推回来。\n\n" +
          "这个操作不可撤销。"
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    const res = await source.deleteJob?.(job.key);
    setDeleting(false);
    if (!res?.ok) {
      setError(res?.reason || "删除失败。");
      return;
    }
    onSaved(); // 复用同一个回调：关闭弹窗 + 重新拉列表
  }

  async function handleSave() {
    if (!writable) {
      setError("当前数据源不支持写入——切换到云端数据源再试。");
      return;
    }
    if (!title.trim() || !company.trim()) {
      setError("岗位名和公司不能为空。");
      return;
    }
    setSaving(true);
    setError("");
    const key = job?.key || newKey();
    const res = await source.upsertJob?.({
      key,
      title: title.trim(),
      company: company.trim(),
      salary,
      // 手填的薪资也走同一套解析（和扩展共用 lib/salary.js，由 npm run check:salary 保证一致）。
      // 解析不出来就存 null，界面会退回显示原文——原文对"面议"这类值是唯一说得清的。
      salaryParsed:
        sal.parsed && sal.min != null && sal.max != null
          ? { min: sal.min, max: sal.max, months: sal.months, period: sal.period }
          : null,
      salarySource: salary.trim() ? "手填" : undefined,
      tagline,
      status: job?.status || "", // 新记录初始状态走下面的 appendStatus 单独写，避免绕过状态历史
      intent: job?.intent || "🔥", // 手动录入默认标"想投"意向，用户可以在列表里再改
      url: job?.url || "",
      site: job?.site || "手动录入",
      ts: job?.ts || new Date().toISOString(),
    });
    if (!res?.ok) {
      setSaving(false);
      setError(res?.reason || "保存失败。");
      return;
    }
    // 状态变了（或是新记录且选了非空初始状态）才追加一次状态历史
    if (status && status !== (job?.status || "")) {
      const r2 = await source.appendStatus?.(key, status);
      if (!r2?.ok) {
        setSaving(false);
        setError(r2?.reason || "状态保存失败。");
        return;
      }
    }
    if (isTerminal(status) && failReason && failReason !== (job?.failReason || "")) {
      const r3 = await source.setFailReason?.(key, failReason);
      if (!r3?.ok) {
        setSaving(false);
        setError(r3?.reason || "归因保存失败。");
        return;
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "新增投递记录" : "编辑投递记录"}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28, 22, 12, .5)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      {/* "一张纸从文件夹里抽出来"：向上滑入 + 极轻的旋转回正。
          280ms，短到不会挡住操作——动效是隐喻的一部分，不是小游戏。 */}
      <div
        className="paper slide-in"
        style={{ width: 430, maxWidth: "92vw", padding: "20px 22px 22px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head" style={{ marginBottom: 16 }}>
          {isNew ? "New Entry" : "Edit Entry"}
          <span className="n">{isNew ? "新增投递记录" : "编辑投递记录"}</span>
        </div>

        {!writable && (
          <div
            style={{
              background: "var(--warn-soft)",
              color: "var(--warn)",
              padding: "8px 10px",
              borderRadius: 5,
              fontSize: 12.5,
              marginBottom: 12,
            }}
          >
            当前数据源「{source.label}」不支持写入。切换到云端数据源（右上角）后再编辑。
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          <Field label="岗位名 *">
            <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!writable} />
          </Field>
          <Field label="公司 *">
            <input value={company} onChange={(e) => setCompany(e.target.value)} disabled={!writable} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="薪资">
              <input value={salary} onChange={(e) => setSalary(e.target.value)} disabled={!writable} placeholder="如 25-40K·15薪" />
              {salary.trim() && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11.5,
                    fontFamily: "var(--mono)",
                    color: sal.parsed ? "var(--ok)" : "var(--warn)",
                  }}
                >
                  {sal.parsed
                    ? `${formatSalary(sal)} · 年 ${(sal.annualMin! / 10000).toFixed(1)}–${(
                        sal.annualMax! / 10000
                      ).toFixed(1)} 万`
                    : `认不出数字（${sal.note}）—— 原文会存下来，但不进薪资统计`}
                </p>
              )}
            </Field>
            <Field label="标签">
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} disabled={!writable} placeholder="城市/年限/学历" />
            </Field>
          </div>

          <Field label="状态">
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} disabled={!writable}>
              {STATUS_CYCLE.map((s) => (
                <option key={s} value={s}>
                  {s || "（未标记）"}
                </option>
              ))}
            </select>
          </Field>

          {isTerminal(status) && (
            <Field label="挂在哪一环（归因）">
              <select value={failReason} onChange={(e) => setFailReason(e.target.value)} disabled={!writable}>
                <option value="">（未归因）</option>
                {FAIL_BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {error && (
          <p style={{ color: "var(--stop)", fontSize: 12.5, marginTop: 10 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          {/* 删除放在编辑框里、和保存隔开，不放列表每一行。
              列表里每行一个删除按钮太容易误点，而这是不可逆操作。
              新增模式下没有可删的东西，所以只在编辑已有记录时出现。 */}
          {!isNew && (
            <button
              className="danger"
              onClick={handleDelete}
              disabled={!writable || saving || deleting}
              title="从云端删除这条记录，并记一条删除标记（防止插件下次同步把它推回来）"
              style={{ marginRight: "auto" }}
            >
              {deleting ? "删除中…" : "删除"}
            </button>
          )}
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--rule-strong)", color: "var(--ink-2)" }}>
            取消
          </button>
          <button onClick={handleSave} disabled={!writable || saving || deleting}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}
