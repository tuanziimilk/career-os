/* JD 匹配分析 · Job Dossier。
 *
 * 这一页的核心不是那个百分比，是**每条结论都能点回 JD 原文**。
 * 所以布局是「左边结论、右边原文」，点结论会滚到并高亮对应的那句话。
 *
 * 刻意没有的东西：
 *   · 四维雷达图（EXPERIENCE/SKILLS/INDUSTRY/GROWTH）——后两维没有可靠数据能算
 *   · 「优秀/良好/一般」这类评价词——它暗示一个我无法验证的判断
 *   · 硬性门槛折进分数——学历不符是闸门不是扣分
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CapabilityLevel, CapabilityRow, DataSource, JobRecord } from "../lib/types";
import { analyzeMatch, coverageLabel, type SkillHit } from "../lib/match";

const LEVEL_TEXT: Record<CapabilityLevel, string> = {
  "🟢": "我做过",
  "🟡": "半会",
  "🔴": "没做过",
  "": "未自评",
};

export function Match({ source }: { source: DataSource }) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [caps, setCaps] = useState<CapabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [focusSent, setFocusSent] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([source.getJobs(), source.getCapabilities()]).then(([j, c]) => {
      setJobs(j);
      setCaps(c);
      setLoading(false);
    });
  }, [source]);

  const picked = useMemo(
    () => jobs.find((j) => j.key === pickedKey) || null,
    [jobs, pickedKey]
  );
  const result = useMemo(
    () => (picked ? analyzeMatch(picked, caps) : null),
    [picked, caps]
  );

  // 点结论 → 滚到原文里那句话
  useEffect(() => {
    if (!focusSent || !bodyRef.current) return;
    const el = bodyRef.current.querySelector<HTMLElement>("[data-hit='1']");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusSent]);

  if (loading) return <p className="meta" style={{ padding: "30px 0" }}>LOADING…</p>;

  if (caps.length === 0) {
    return (
      <section>
        <div className="section-head">
          Job Dossier
          <span className="n">JD 匹配分析</span>
        </div>
        <p style={{ fontSize: 14, color: "var(--ink-2)", maxWidth: "62ch" }}>
          这一页要拿「我的能力自评」去比对 JD 要求，但当前数据源里没有任何能力自评，
          所以什么都算不出来。
        </p>
        <p className="meta" style={{ marginTop: 8 }}>
          能力自评存在 <code>career_profile.capabilities</code>。
          切换到云端数据源，或先在演示数据里看这一页长什么样。
        </p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section>
        <div className="section-head">
          Job Dossier
          <span className="n">选一条 JD 做匹配分析</span>
        </div>
        <JobPicker jobs={jobs} caps={caps} picked={pickedKey} onPick={setPickedKey} />
      </section>

      {picked && result && (
        <>
          {/* ── 档案头 ─────────────────────────────── */}
          <section>
            <div
              style={{
                display: "flex",
                gap: 18,
                alignItems: "flex-start",
                flexWrap: "wrap",
                borderTop: "2px solid var(--ink)",
                borderBottom: "1px solid var(--rule)",
                padding: "12px 0",
              }}
            >
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <h2 style={{ fontSize: 21 }}>{picked.title}</h2>
                <div className="label" style={{ marginTop: 3 }}>
                  {picked.company}
                  {picked.tagline ? " · " + picked.tagline : ""}
                </div>
                {picked.salary && (
                  <div className="meta-strong" style={{ marginTop: 5 }}>
                    {picked.salary}
                  </div>
                )}
              </div>

              {/* 覆盖率。审阅印章的位置，但数字本身不带评价词 */}
              <div style={{ flex: "0 0 auto", textAlign: "right", minWidth: 150 }}>
                <div className="refno">Skill Coverage</div>
                {result.ok ? (
                  <>
                    <div
                      style={{
                        fontFamily: "var(--serif)",
                        fontSize: 44,
                        fontWeight: 700,
                        lineHeight: 1,
                        color: result.coverage == null ? "var(--ink-3)" : "var(--ink)",
                      }}
                    >
                      {result.coverage == null ? "—" : result.coverage + "%"}
                    </div>
                    <div className="label" style={{ marginTop: 3, maxWidth: 190 }}>
                      {coverageLabel(result.coverage)}
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontSize: 44,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: "var(--ink-3)",
                    }}
                  >
                    —
                  </div>
                )}
              </div>
            </div>
          </section>

          {!result.ok ? (
            <section>
              <p className="annot" style={{ fontSize: 14 }}>
                分析不了：{result.reason}
              </p>
              <p className="meta" style={{ marginTop: 8, maxWidth: "60ch" }}>
                为什么不给一个 0 分：那会被读成"这岗位不匹配"，而真实情况是"我们没抓到内容"。
                这两件事的处理方式完全相反。
              </p>
            </section>
          ) : (
            <>
              {/* ── 硬性门槛 ─────────────────────────── */}
              {result.gates.length > 0 && (
                <section>
                  <div className="section-head">
                    Hard Gates
                    <span className="n">硬性门槛 · 不计入覆盖率</span>
                  </div>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    {result.gates.map((g) => (
                      <div key={g.id}>
                        <div className="refno">{g.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                          {g.required}
                        </div>
                        <button
                          className="ghost"
                          onClick={() => setFocusSent(g.evidence)}
                          style={{ marginTop: 5, padding: "2px 6px", fontSize: 11 }}
                        >
                          看原文
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="meta" style={{ marginTop: 10, maxWidth: "60ch" }}>
                    门槛刻意不折进百分比：「85% 但学历不符」看起来比「70% 且完全符合」好，
                    但投递结果完全相反。
                  </p>
                </section>
              )}

              {/* ── 结论 + 原文 ──────────────────────── */}
              <section>
                <div className="section-head">
                  Editor&apos;s Marks
                  <span className="n">
                    每条结论都能点回原文 · 依据{" "}
                    {result.source === "body" ? "JD 正文" : "整页兜底文本"} {result.textLength} 字
                  </span>
                </div>
                <div className="dossier">
                  {/* 左：结论 */}
                  <div style={{ display: "grid", gap: 16 }}>
                    <HitGroup
                      title="短板"
                      sub="JD 要求，我没做过"
                      tone="var(--red)"
                      hits={result.gaps}
                      onFocus={setFocusSent}
                    />
                    <HitGroup
                      title="半会"
                      sub="做过一部分，面试会被追问"
                      tone="var(--warn)"
                      hits={result.partial}
                      onFocus={setFocusSent}
                    />
                    <HitGroup
                      title="强项"
                      sub="JD 要求，我做过"
                      tone="var(--ok)"
                      hits={result.strong}
                      onFocus={setFocusSent}
                    />
                    {result.unrated.length > 0 && (
                      <HitGroup
                        title="不知道"
                        sub="JD 要求，但这几个能力组我还没自评"
                        tone="var(--ink-3)"
                        hits={result.unrated}
                        onFocus={setFocusSent}
                      />
                    )}
                    {result.unusedStrengths.length > 0 && (
                      <div>
                        <div className="refno" style={{ marginBottom: 5 }}>
                          用不上的强项
                        </div>
                        <p className="label" style={{ margin: 0 }}>
                          {result.unusedStrengths.join("、")}
                        </p>
                        <p className="meta" style={{ marginTop: 4 }}>
                          这条 JD 没提这些——投的时候不用重点写。
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 右：JD 原文 + 荧光笔 */}
                  <div
                    ref={bodyRef}
                    className="clipping"
                    style={{
                      padding: "12px 14px",
                      maxHeight: 520,
                      overflowY: "auto",
                      fontSize: 13.5,
                      lineHeight: 1.85,
                    }}
                  >
                    <div className="refno" style={{ marginBottom: 8 }}>
                      JD 原文
                    </div>
                    <JdText
                      text={result.source === "body" ? picked.body || "" : picked.pageText || ""}
                      hits={[...result.gaps, ...result.partial, ...result.strong, ...result.unrated]}
                      focus={focusSent}
                    />
                  </div>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {!picked && jobs.length > 0 && (
        <p className="meta" style={{ padding: "10px 0" }}>
          上面选一条岗位开始分析。
        </p>
      )}
    </div>
  );
}

/* ── 岗位选择器 ─────────────────────────────────────────
   直接在列表里显示每条的覆盖率，这样"该分析哪条"本身就有依据。
   分析不了的显示 —，而不是 0%。 */
function JobPicker({
  jobs,
  caps,
  picked,
  onPick,
}: {
  jobs: JobRecord[];
  caps: CapabilityRow[];
  picked: string | null;
  onPick: (k: string) => void;
}) {
  const rows = useMemo(
    () =>
      jobs
        .map((j) => {
          const r = analyzeMatch(j, caps);
          return { job: j, cov: r.ok ? r.coverage : null, analyzable: r.ok };
        })
        .sort((a, b) => (b.cov ?? -1) - (a.cov ?? -1)),
    [jobs, caps]
  );

  if (jobs.length === 0) {
    return <p className="meta">当前数据源里没有岗位记录。</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>岗位</th>
          <th>公司</th>
          <th style={{ width: 74 }}>覆盖率</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ job, cov, analyzable }) => (
          <tr
            key={job.key}
            onClick={() => onPick(job.key)}
            style={{
              cursor: "pointer",
              background: picked === job.key ? "var(--paper-2)" : undefined,
              outline: picked === job.key ? "2px solid var(--ink)" : undefined,
            }}
          >
            <td style={{ fontWeight: picked === job.key ? 700 : 500 }}>{job.title}</td>
            <td style={{ color: "var(--ink-2)" }}>{job.company}</td>
            <td className="meta-strong">
              {cov == null ? (
                <span
                  style={{ color: "var(--ink-3)" }}
                  title={analyzable ? "命中的能力组还没自评" : "没有 JD 正文，分析不了"}
                >
                  —
                </span>
              ) : (
                cov + "%"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HitGroup({
  title,
  sub,
  tone,
  hits,
  onFocus,
}: {
  title: string;
  sub: string;
  tone: string;
  hits: SkillHit[];
  onFocus: (s: string) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 7,
          borderBottom: "1px solid var(--rule)",
          paddingBottom: 4,
          marginBottom: 7,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: tone }}>{title}</span>
        <span className="meta-strong" style={{ color: tone }}>
          {hits.length}
        </span>
        <span className="meta" style={{ marginLeft: "auto" }}>
          {sub}
        </span>
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {hits.map((h) => (
          <div key={h.id}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{h.label}</span>
              <span className="meta">{LEVEL_TEXT[h.level ?? ""]}</span>
              <button
                className="ghost"
                onClick={() => onFocus(h.evidence)}
                style={{ marginLeft: "auto", padding: "1px 6px", fontSize: 10.5 }}
                title="滚到 JD 原文里对应的句子"
              >
                依据
              </button>
            </div>
            {/* 批注：JD 里那句话，红笔风格。这是这一页的全部可信度来源 */}
            <p className="annot" style={{ margin: "2px 0 0", fontSize: 12.5, color: tone }}>
              「{h.evidence}」
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* JD 原文 + 荧光笔。命中的句子整句高亮，被点中的那句额外加边框。
   高亮做在句子级而不是关键词级：关键词高亮会碎成一堆黄点，
   而"哪句话让我得出这个结论"才是要看的东西。 */
function JdText({
  text,
  hits,
  focus,
}: {
  text: string;
  hits: SkillHit[];
  focus: string | null;
}) {
  const marked = useMemo(() => {
    const evid = new Set(hits.map((h) => h.evidence));
    const lines = text.split(/\r?\n/);
    return lines.map((line, i) => {
      const trimmed = line.trim();
      // 逐句判断：evidence 是截断到 160 字的，所以用 includes 双向匹配
      const hit = [...evid].find((e) => trimmed.includes(e) || e.includes(trimmed.slice(0, 40)));
      const isFocus = !!(focus && hit && (focus === hit || hit.includes(focus.slice(0, 30))));
      return { key: i, line, hit: !!hit && trimmed.length >= 4, isFocus };
    });
  }, [text, hits, focus]);

  if (!text.trim()) return <p className="meta">（没有原文）</p>;

  return (
    <div>
      {marked.map((m) =>
        m.line.trim() === "" ? (
          <div key={m.key} style={{ height: 7 }} />
        ) : (
          <p
            key={m.key}
            data-hit={m.isFocus ? "1" : undefined}
            style={{
              margin: "0 0 2px",
              padding: m.isFocus ? "2px 5px" : undefined,
              outline: m.isFocus ? "1.5px solid var(--red)" : undefined,
              transition: "outline-color 200ms",
            }}
          >
            {m.hit ? <span className="hl">{m.line}</span> : m.line}
          </p>
        )
      )}
    </div>
  );
}
