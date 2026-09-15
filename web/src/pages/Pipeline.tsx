/* 投递页 = 招聘剪报墙 + 档案登记册。
 *
 * 两个视图切换，不是两个页面：
 *   CLIPPINGS —— 剪报墙。用来"看"，一眼扫出哪些要管（红章）、哪些成了（绿章）。
 *   LOGBOOK   —— 登记册。用来"查"，能排序、能对着编号说事。
 * 同一批数据两种读法，对应两种真实场景，不是为了多一个 tab。
 */
import { useEffect, useMemo, useState } from "react";
import type { CapabilityRow, DataSource, Intent, JobRecord, Status } from "../lib/types";
import { computeFunnel, failBreakdown, needsFollowUp } from "../lib/funnel";
import { FunnelChart } from "../components/FunnelChart";
import { CapabilityBars } from "../components/CapabilityBars";
import { JobEditModal } from "../components/JobEditModal";
import { JobClipping } from "../components/JobClipping";
import { Stamp, statusStamp } from "../components/Stamp";
import { formatSalary } from "../lib/salary";

const INTENT_OPTIONS: { value: Intent | "all"; label: string }[] = [
  { value: "all", label: "全部意向" },
  { value: "🔥", label: "🔥 想投" },
  { value: "👀", label: "👀 观察" },
  { value: "❌", label: "❌ 不考虑" },
  { value: "", label: "（未定）" },
];

const STATUS_FILTER_OPTIONS: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "", label: "仅采集" },
  { value: "想投", label: "想投" },
  { value: "已投", label: "已投" },
  { value: "进面", label: "进面" },
  { value: "复面", label: "复面" },
  { value: "offer", label: "offer" },
  { value: "已挂", label: "已挂" },
  { value: "已拒", label: "已拒" },
];

const MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "SEP 08" —— 登记册里日期用报纸格式，比 2026-09-08 更像手写台账 */
function logDate(ts: string): string {
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return MONTH_EN[d.getMonth()] + " " + String(d.getDate()).padStart(2, "0");
}

export function Pipeline({ source }: { source: DataSource }) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [caps, setCaps] = useState<CapabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<JobRecord | null | "new">(null);
  const [view, setView] = useState<"clippings" | "logbook">("clippings");

  const [q, setQ] = useState("");
  const [intentFilter, setIntentFilter] = useState<Intent | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  // null = 采集时间序。点表头在 降序 → 升序 → 不排序 之间循环。
  const [sortBySalary, setSortBySalary] = useState<"desc" | "asc" | null>(null);

  async function load() {
    setLoading(true);
    const [j, c] = await Promise.all([source.getJobs(), source.getCapabilities()]);
    setJobs(j);
    setCaps(c);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const funnel = useMemo(() => computeFunnel(jobs), [jobs]);
  const followUps = useMemo(() => needsFollowUp(jobs), [jobs]);
  const fails = useMemo(() => failBreakdown(jobs), [jobs]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const rows = jobs.filter((j) => {
      if (intentFilter !== "all" && j.intent !== intentFilter) return false;
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (kw && !(j.title.toLowerCase().includes(kw) || j.company.toLowerCase().includes(kw))) {
        return false;
      }
      return true;
    });
    if (!sortBySalary) return rows;
    // 没有结构化薪资的一律排最后，不管升降序——它们不是"薪资为 0"，
    // 是"不知道薪资"，混进数字序列会让人误读。
    return rows.slice().sort((a, b) => {
      const av = a.salaryParsed?.max;
      const bv = b.salaryParsed?.max;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortBySalary === "desc" ? bv - av : av - bv;
    });
  }, [jobs, q, intentFilter, statusFilter, sortBySalary]);

  if (loading) {
    return <p className="meta" style={{ padding: "30px 0" }}>LOADING…</p>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── 版面数据条 ───────────────────────────────── */}
      <section>
        <div className="section-head">
          Pipeline Summary
          <span className="n">阈值 {funnel.silentDays} 天无回音</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
            borderTop: "1px solid var(--rule)",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          {(
            [
              ["Clipped", String(jobs.length), "已采集"],
              ["Applied", String(funnel.applied), "已投递"],
              [
                "Silent",
                funnel.silentRate == null ? "—" : Math.round(funnel.silentRate * 100) + "%",
                "沉默率",
              ],
              [
                "Reply",
                funnel.replyMedianDays == null ? "—" : funnel.replyMedianDays + "d",
                "回音中位",
              ],
            ] as [string, string, string][]
          ).map(([en, val, cn], i) => (
            <div key={en} style={{ padding: "10px 12px", borderLeft: i === 0 ? 0 : "1px solid var(--rule)" }}>
              <div className="refno">{en}</div>
              <div
                style={{
                  fontFamily: "var(--serif)",
                  fontSize: 26,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  margin: "3px 0 1px",
                }}
              >
                {val}
              </div>
              <div className="label">{cn}</div>
            </div>
          ))}
        </div>
      </section>

      {jobs.length === 0 ? (
        <div className="clipping" style={{ padding: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>
            当前数据源里还没有任何岗位记录。
            {source.kind === "local" && " 检查选中的文件夹里是否有 jd_backup.json。"}
            {source.kind === "supabase" &&
              " 先用 jd-insight 扩展采集并同步，或点下面「新增」手动录入（猎头推荐、内推这类没有 JD 详情页的机会）。"}
            {source.kind === "demo" && " 这是演示数据，不该是空的——请检查 demoData.ts。"}
          </p>
          <button style={{ marginTop: 12 }} onClick={() => setEditing("new")}>
            ＋ New Entry
          </button>
        </div>
      ) : (
        <>
          {/* ── 漏斗 ───────────────────────────────────── */}
          <section>
            <div className="section-head">
              The Funnel
              <span className="n">投递漏斗</span>
            </div>
            <FunnelChart rows={funnel.rows} />
          </section>

          {/* ── 剪报墙 / 登记册 ───────────────────────── */}
          <section>
            <div className="section-head">
              {view === "clippings" ? "Application Pipeline" : "Application Logbook"}
              <span className="n">
                {filtered.length} / {jobs.length} 条
              </span>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 14,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <input
                placeholder="搜索岗位 / 公司…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: "1 1 150px", minWidth: 120 }}
              />
              <select value={intentFilter} onChange={(e) => setIntentFilter(e.target.value as Intent | "all")}>
                {INTENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | "all")}>
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* 视图切换做成两个咬合的档案标签，不是 segmented control */}
              <span style={{ display: "flex" }}>
                {(
                  [
                    ["clippings", "剪报墙"],
                    ["logbook", "登记册"],
                  ] as ["clippings" | "logbook", string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    className={view === v ? "" : "ghost"}
                    onClick={() => setView(v)}
                    style={{ borderRadius: 0, padding: "8px 10px" }}
                  >
                    {label}
                  </button>
                ))}
              </span>
              <button onClick={() => setEditing("new")}>＋ New</button>
            </div>

            {filtered.length === 0 ? (
              <p className="meta" style={{ padding: "18px 0", textAlign: "center" }}>
                没有匹配的记录。
              </p>
            ) : view === "clippings" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(238px, 1fr))",
                  gap: 12,
                }}
              >
                {filtered.map((j) => (
                  <JobClipping key={j.key} job={j} onEdit={() => setEditing(j)} />
                ))}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Ref</th>
                    <th style={{ width: 62 }}>Date</th>
                    <th>Role</th>
                    <th>Company</th>
                    <th>
                      <button
                        onClick={() =>
                          setSortBySalary((s) => (s === null ? "desc" : s === "desc" ? "asc" : null))
                        }
                        title="按月薪上限排序。没识别出薪资的始终排最后"
                        style={{
                          background: "transparent",
                          border: 0,
                          padding: 0,
                          font: "inherit",
                          letterSpacing: "inherit",
                          color: sortBySalary ? "var(--red)" : "inherit",
                          cursor: "pointer",
                        }}
                      >
                        Salary {sortBySalary === "desc" ? "↓" : sortBySalary === "asc" ? "↑" : "⇅"}
                      </button>
                    </th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((j, i) => {
                    const st = statusStamp(j.status);
                    return (
                      <tr key={j.key}>
                        <td className="refno">AP-{String(i + 1).padStart(3, "0")}</td>
                        <td className="meta">{logDate(j.ts)}</td>
                        <td style={{ fontSize: 14, fontWeight: 600 }}>
                          {j.title}
                        </td>
                        <td style={{ color: "var(--ink-2)" }}>
                          {j.company || <span className="annot">未抓到</span>}
                        </td>
                        <td
                          className="meta-strong"
                          title={j.salarySource ? "来源：" + j.salarySource : undefined}
                        >
                          {j.salaryParsed ? (
                            formatSalary({ raw: j.salary, parsed: true, ...j.salaryParsed })
                          ) : j.salary ? (
                            <span style={{ color: "var(--ink-3)" }}>~{j.salary}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <Stamp tone={st.tone}>{st.text}</Stamp>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="ghost"
                            onClick={() => setEditing(j)}
                            style={{ padding: "3px 7px", fontSize: 9.5, borderWidth: 1 }}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* ── 待跟进 ─────────────────────────────────── */}
          {followUps.length > 0 && (
            <section>
              <div className="section-head" style={{ borderBottomColor: "var(--red)" }}>
                <span style={{ color: "var(--red)" }}>Needs Follow-up</span>
                <span className="n">沉默 ≥ {funnel.silentDays} 天</span>
              </div>
              <div style={{ display: "grid", gap: 0 }}>
                {followUps.map((f) => (
                  <div
                    key={f.key}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 9,
                      padding: "7px 0",
                      borderBottom: "1px solid var(--rule)",
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {f.title}
                    </span>
                    <span className="meta">{f.company}</span>
                    <span className="meta-strong" style={{ marginLeft: "auto", color: "var(--red)" }}>
                      {f.silentFor} DAYS
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── 挂掉归因 ───────────────────────────────── */}
          {fails.length > 0 && (
            <section>
              <div className="section-head">
                Post-mortem
                <span className="n">挂掉归因</span>
              </div>
              <div style={{ display: "grid", gap: 0 }}>
                {fails.map(([reason, count]) => (
                  <div
                    key={reason}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "6px 0",
                      borderBottom: "1px solid var(--rule)",
                      fontSize: 13,
                    }}
                  >
                    <span>{reason}</span>
                    <span
                      style={{
                        flex: 1,
                        borderBottom: "1px dotted var(--rule-strong)",
                        transform: "translateY(-3px)",
                      }}
                    />
                    <span className="meta-strong" style={{ fontSize: 13 }}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {caps.length > 0 && (
            <section>
              <div className="section-head">
                Skill Coverage
                <span className="n">能力覆盖率 vs 我的现状</span>
              </div>
              <CapabilityBars rows={caps} />
            </section>
          )}
        </>
      )}

      {editing !== null && (
        <JobEditModal
          source={source}
          job={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
