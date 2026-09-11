/* 07 校准台 —— 能力自评编辑 + 技能词典体检。
 *
 * ══════════ 为什么这两件事在同一页 ══════════
 *
 * 它们之间有一条硬约束：`skills.json` 的 note 里写着
 *   「group 必须和 career_profile.capabilities 里的能力组名**逐字一致**」
 * 而在此之前，能力自评**没有任何编辑界面** —— `updateCapabilities()` 在
 * supabaseSource 里实现完整、types.ts 里声明了，全项目零调用者。想改只能去
 * Supabase Dashboard 手改 jsonb，那等于让人手写这 15 个组名。写错一个字，
 * 匹配分析就静默少算一整组能力，而界面上看不出任何异常。
 *
 * 所以这一页的组名**不给输入框，从词典派生**（`GROUPS` 常量）。
 * 打错字这一整类问题就此消失。这也是把两件事放一起的真正理由 ——
 * 不是"都属于设置"，是它们共用同一份组名。
 *
 * ══════════ 为什么词典体检是只读的 ══════════
 *
 * `skills.json` 是**编译进前端产物的静态文件**（`match.ts` 直接 import），
 * 运行时改不了。要让它可写，得先把词典搬到云端表 —— 那是 P2 的事。
 *
 * 但"看不见"和"改不了"是两个问题，而**"看不见"是黑箱感的主要来源**。
 * 所以先解决看得见：26 项的权重、patterns、校准记录全部摊开，
 * 并且**用你真实采集的 JD 跑一遍，显示每一项到底命中了哪些原句**。
 * 一个能看见自己在干什么的词典，就算只能改代码，也不再是黑箱。
 */
import { useEffect, useMemo, useState } from "react";
import type { CapabilityLevel, CapabilityRow, DataSource, JobRecord } from "../lib/types";
import { SKILLS, DICT_META, auditSkill } from "../lib/match";
/* note ↔ 等级的互转搬去 lib/capabilityNote.ts 了 ——
   它有一套断言（scripts/eval-capability-note.mjs），而页面组件测不了。
   这里错一个字符会让所有等级静默变成「未评估」，值得单独钉住。 */
import { composeNote, splitNote } from "../lib/capabilityNote";
import thresholdsData from "../data/thresholds.json";

/* 能力组从词典派生，不手写。
   ⚠️ 顺序刻意用词典里的出现顺序，而不是字母序或按 level 排 ——
   词典的排列本身就是"产品基本功 → AI 能力 → 行业"这个从通用到专门的顺序，
   照它排，读起来才是一条线索而不是一堆标签。 */
const GROUPS: string[] = [...new Set(SKILLS.map((s) => s.group))];

/* 阈值登记表。它是数据不是代码 —— 常量本身仍在各自源文件里，
   由 scripts/check-thresholds.mjs 逐字核对两边一致（改一边不改另一边就让 build 失败）。 */
interface ThresholdRow {
  id: string;
  name: string;
  value: string;
  file: string;
  measured: "yes" | "partial" | "no";
  rationale: string;
  risk?: string;
}
const THRESHOLDS = (thresholdsData as { thresholds: ThresholdRow[] }).thresholds;
const byMeasured = THRESHOLDS.reduce(
  (acc, t) => ({ ...acc, [t.measured]: (acc[t.measured] || 0) + 1 }),
  { yes: 0, partial: 0, no: 0 } as Record<string, number>
);

const LEVELS: { v: CapabilityLevel; label: string; hint: string }[] = [
  { v: "🟢", label: "🟢 有真实项目支撑", hint: "能在面试里讲出具体做了什么、结果是什么" },
  { v: "🟡", label: "🟡 概念懂但缺实操", hint: "讲得清原理，但没有自己做过的例子" },
  { v: "🔴", label: "🔴 空白", hint: "没做过，也讲不清" },
  { v: "", label: "未评估", hint: "还没想过。⚠️ 这和「不会」不是一回事——匹配分析的分母只算已评估的项" },
];

interface Draft {
  level: CapabilityLevel;
  text: string;
}

export function Calibration({ source }: { source: DataSource }) {
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [saved, setSaved] = useState<Record<string, Draft>>({});
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [msg, setMsg] = useState("");
  const [msgBad, setMsgBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openSkill, setOpenSkill] = useState<string | null>(null);

  const writable = source.kind === "supabase";

  async function reload() {
    const [caps, js] = await Promise.all([source.getCapabilities(), source.getJobs()]);
    const d: Record<string, Draft> = {};
    GROUPS.forEach((g) => (d[g] = { level: "", text: "" }));
    caps.forEach((c) => {
      const { level, text } = splitNote(c.note);
      d[c.group] = { level, text };
    });
    setDraft(d);
    setSaved(JSON.parse(JSON.stringify(d)));
    setJobs(js);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [caps, js] = await Promise.all([source.getCapabilities(), source.getJobs()]);
      if (!alive) return;
      const d: Record<string, Draft> = {};
      GROUPS.forEach((g) => (d[g] = { level: "", text: "" }));
      /* ⚠️ 已存的自评里可能有**词典里已经没有的组名**（改过词典、或当初手写错了）。
         那种行不能悄悄丢掉——它是你填过的真实内容。单独收进 orphan 里显示出来。 */
      caps.forEach((c) => {
        const { level, text } = splitNote(c.note);
        d[c.group] = { level, text };
      });
      setDraft(d);
      setSaved(JSON.parse(JSON.stringify(d)));
      setJobs(js);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [source]);

  /** 存过但词典里没有的组 —— 不丢，显示出来让人自己决定 */
  const orphans = useMemo(
    () => Object.keys(draft).filter((g) => !GROUPS.includes(g)),
    [draft]
  );

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  const rated = GROUPS.filter((g) => draft[g]?.level).length;

  /* ⚠️ 整份体检必须 useMemo，而且只依赖 jobs。
     第一版是在渲染里逐项调 auditSkill()，于是**在自评输入框里每敲一个字，
     26 项 × 10 条 JD × 每项十几个 pattern × 每条几十句**全部重跑一遍。
     打字会明显卡 —— 而这一页的两半（自评编辑、词典体检）本来毫不相干，
     一半的输入不该拖动另一半的计算。 */
  const audits = useMemo(() => {
    const m = new Map<string, ReturnType<typeof auditSkill>>();
    SKILLS.forEach((sk) => m.set(sk.id, auditSkill(sk.id, jobs)));
    return m;
  }, [jobs]);

  /* 分母：有正文、能参与统计的条数 —— 不是 JD 总数。
     ⚠️ 第一版标题写「拿 10 条 JD 实跑」而每行分母是 /5（10 条里只有 5 条有正文），
     标题和表格自相矛盾。口径不一致会直接让人不信这张表里的任何数字，
     所以这里和 gap.js 的做法对齐：把「总数」和「参与统计的条数」都说出来。 */
  const analyzable = audits.size ? (audits.values().next().value?.analyzable ?? 0) : 0;

  async function save() {
    if (!writable) return;
    setBusy(true);
    setMsg("保存中…");
    setMsgBad(false);
    const rows: CapabilityRow[] = Object.entries(draft)
      .map(([group, d]) => ({
        group,
        note: composeNote(d.level, d.text),
        level: d.level,
      }))
      /* 完全空白的组不写进去。理由：`updateCapabilities` 是**整个 jsonb 覆盖**，
         把 15 个空串写进去会让 getCapabilities 读回 15 行"未评估"，
         而 Match 页判断"有没有自评"用的是 `caps.length === 0` ——
         那样它会以为你评过了，然后算出一个分母为 0 的覆盖率。 */
      .filter((r) => r.note !== "");
    const res = await source.updateCapabilities!(rows);
    setBusy(false);
    if (res.ok) {
      setSaved(JSON.parse(JSON.stringify(draft)));
      setMsg(`已保存 ${rows.length} 组。04 匹配分析的覆盖率会跟着变。`);
    } else {
      setMsg(res.reason || "保存失败");
      setMsgBad(true);
      /* ⚠️ 自评是**整个 jsonb 覆盖**写的，所以冲突在这一页后果最重：
         另一端新填了一组，这一页保存就会把那一组整个抹掉。
         必须重新读，而且要把用户正在编的草稿也换成云端的值 ——
         留着旧草稿等于把"再点一次保存"变成"再覆盖一次"。 */
      if (res.conflict) await reload();
    }
  }

  if (loading) return <p className="meta" style={{ padding: "30px 0" }}>LOADING…</p>;

  return (
    <div style={{ display: "grid", gap: 26 }}>
      {/* ── 能力自评 ─────────────────────────────── */}
      <section>
        <div className="section-head">
          Self Assessment
          <span className="n">
            我的能力自评 · 已评 {rated}/{GROUPS.length} 组
          </span>
        </div>

        <p style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: "64ch", margin: "0 0 4px" }}>
          这是 <strong>04 匹配分析</strong>和缺口排行的唯一输入。在这之前它没有编辑界面 ——
          只能去 Supabase 后台改 jsonb。
        </p>
        <p className="meta" style={{ margin: "0 0 14px" }}>
          组名从技能词典派生，不给你手填 —— 词典要求两边逐字一致，手填一个错字就会静默少算一整组。
        </p>

        {!writable && (
          <p
            className="meta"
            style={{ color: "var(--warn)", border: "1px solid var(--warn)", borderLeftWidth: 3, padding: "9px 11px", margin: "0 0 14px" }}
          >
            当前数据源是「{source.label}」，只读。切到云端数据源才能保存 ——
            自评存在 <code>career_profile.capabilities</code>，需要登录。
          </p>
        )}

        <div style={{ display: "grid", gap: 0, border: "1px solid var(--rule)" }}>
          {GROUPS.map((g, i) => {
            const d = draft[g] || { level: "", text: "" };
            return (
              <div
                key={g}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,150px) minmax(0,180px) minmax(0,1fr)",
                  gap: 10,
                  padding: "10px 12px",
                  alignItems: "start",
                  borderTop: i === 0 ? "none" : "1px solid var(--rule)",
                  background: d.level ? "transparent" : "color-mix(in srgb, var(--paper-2) 40%, transparent)",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, paddingTop: 6 }}>{g}</span>
                <select
                  value={d.level}
                  disabled={!writable}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, [g]: { ...d, level: e.target.value as CapabilityLevel } }))
                  }
                >
                  {LEVELS.map((l) => (
                    <option key={l.v} value={l.v}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <input
                  value={d.text}
                  disabled={!writable}
                  placeholder={d.level ? "具体做过什么 / 缺哪一截（会显示在匹配分析里）" : "先选一个等级"}
                  onChange={(e) => setDraft((p) => ({ ...p, [g]: { ...d, text: e.target.value } }))}
                />
              </div>
            );
          })}
        </div>

        {orphans.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="meta" style={{ color: "var(--warn)" }}>
              下面这些组存在你的自评里，但**词典里已经没有**（改过词典或当初手写错了）。
              不会自动删 —— 保存时仍会写回。要清掉就把内容删空。
            </p>
            {orphans.map((g) => (
              <div key={g} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
                <code style={{ fontSize: 12 }}>{g}</code>
                <input
                  value={draft[g]?.text || ""}
                  disabled={!writable}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, [g]: { ...(p[g] || { level: "" }), text: e.target.value } }))
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <button onClick={save} disabled={!writable || !dirty || busy}>
            保存自评
          </button>
          {dirty && <span className="meta">有未保存的改动</span>}
          {msg && (
            <span className="meta" style={{ color: msgBad ? "var(--stop)" : "var(--ok)" }}>
              {msg}
            </span>
          )}
        </div>
      </section>

      {/* ── 词典体检 ─────────────────────────────── */}
      <section>
        <div className="section-head">
          Dictionary Audit
          <span className="n">
            技能词典体检 · {SKILLS.length} 项 · {jobs.length} 条 JD 里 {analyzable} 条有正文参与统计
          </span>
        </div>

        <p style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: "64ch", margin: "0 0 4px" }}>
          这份词典决定「你缺什么能力」和「先补哪个」。它<strong>只能改代码</strong>
          （<code>src/data/skills.json</code>，改完要跑 <code>npm run check:shared -- --fix</code>）——
          但至少现在你能看见它在干什么。
        </p>
        <p className="meta" style={{ margin: "0 0 14px" }}>
          「命中」是拿你真实采集的 JD 现场跑出来的，不是预设值。命中 0 的项要么这批 JD 真的不要，
          要么 patterns 写漏了 —— 点开看它想匹配什么。
          {jobs.length !== analyzable && (
            <>
              <br />
              分母是 {analyzable} 而不是 {jobs.length}：另外 {jobs.length - analyzable} 条正文不足
              120 字（多半是在列表页存的），算进去只会让每一项的命中率被系统性低估。
            </>
          )}
        </p>

        <div style={{ display: "grid", gap: 0, border: "1px solid var(--rule)" }}>
          {SKILLS.map((sk, i) => {
            const audit = audits.get(sk.id)!;
            const open = openSkill === sk.id;
            return (
              <div key={sk.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                <button
                  onClick={() => setOpenSkill(open ? null : sk.id)}
                  style={{
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 62px 74px 84px",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "9px 12px",
                    background: "transparent",
                    border: 0,
                    borderRadius: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <span style={{ fontSize: 13 }}>
                    <strong>{sk.label}</strong>
                    <span className="meta" style={{ marginLeft: 8 }}>
                      {sk.group}
                    </span>
                  </span>
                  <span className="meta" style={{ textAlign: "right" }}>
                    ×{sk.weight}
                  </span>
                  <span
                    className="meta"
                    style={{
                      textAlign: "right",
                      color: audit.hitCount === 0 ? "var(--warn)" : "var(--ink-2)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {audit.hitCount}/{audit.analyzable}
                  </span>
                  <span className="meta" style={{ textAlign: "right" }}>
                    {sk.patterns.length} 词 {open ? "▾" : "▸"}
                  </span>
                </button>

                {open && (
                  <div
                    style={{
                      padding: "0 12px 12px",
                      display: "grid",
                      gap: 8,
                      background: "color-mix(in srgb, var(--paper-2) 45%, transparent)",
                    }}
                  >
                    <div>
                      <span className="label">patterns</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                        {sk.patterns.map((p) => (
                          <code
                            key={p}
                            style={{
                              fontSize: 11.5,
                              padding: "1px 5px",
                              border: "1px solid var(--rule)",
                              background: audit.matchedPatterns.includes(p)
                                ? "color-mix(in srgb, var(--ok) 16%, transparent)"
                                : "transparent",
                            }}
                            title={audit.matchedPatterns.includes(p) ? "在你的 JD 里命中过" : "这批 JD 里没命中过"}
                          >
                            {p}
                          </code>
                        ))}
                      </div>
                      <p className="meta" style={{ marginTop: 4 }}>
                        绿底 = 在你的 JD 里真命中过。全是白底说明这一项的词表还没被验证过。
                      </p>
                    </div>

                    {audit.evidence.length > 0 && (
                      <div>
                        <span className="label">命中的原句</span>
                        <ul style={{ margin: "4px 0 0", paddingLeft: "1.2em", display: "grid", gap: 4 }}>
                          {audit.evidence.map((e, k) => (
                            <li key={k} style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                              <span className="meta">{e.company}</span> {e.sentence}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {audit.hitCount === 0 && (
                      <p className="meta" style={{ color: "var(--warn)" }}>
                        这批 JD 里一次都没命中。可能是这个方向的岗位真的不要，也可能是 patterns 写漏了。
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {jobs.length === 0 && (
          <p className="meta" style={{ marginTop: 10, color: "var(--warn)" }}>
            当前数据源里没有 JD，所以「命中」全是 0/0 —— 那不代表词典有问题。
            去用扩展采集几条，或切到演示数据源。
          </p>
        )}
      </section>

      {/* ── 阈值登记 ─────────────────────────────── */}
      <section>
        <div className="section-head">
          Thresholds
          <span className="n">
            阈值登记 · {THRESHOLDS.length} 项 · 有正当依据 {byMeasured.yes} / 数字是拍的{" "}
            {byMeasured.partial} / 没依据 {byMeasured.no}
          </span>
        </div>

        <p style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: "64ch", margin: "0 0 4px" }}>
          这些数字决定「几条 JD 才算够」「哪句原文当依据」「覆盖率算出来是多少」。
          <strong>它们绝大多数是我拍的</strong> —— 这一栏就是把「哪些有依据、哪些没有」摊开。
        </p>
        <p className="meta" style={{ margin: "0 0 14px" }}>
          常量仍在各自源文件里（搬到一处会成为第四个会漂的副本）。
          <code>npm run check:thresholds</code> 会逐字核对这张表和源码，
          <strong>改了一边没改另一边就让 build 失败</strong> —— 所以这张表不是文档，是契约。
        </p>

        <div style={{ display: "grid", gap: 0, border: "1px solid var(--rule)" }}>
          {THRESHOLDS.map((t, i) => (
            <div
              key={t.id}
              style={{
                padding: "10px 12px",
                borderTop: i === 0 ? "none" : "1px solid var(--rule)",
                background:
                  t.measured === "no"
                    ? "color-mix(in srgb, var(--warn) 7%, transparent)"
                    : "transparent",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>{t.name}</strong>
                <code style={{ fontSize: 12 }}>{t.value}</code>
                <span
                  className="stamp"
                  style={{
                    color:
                      t.measured === "yes"
                        ? "var(--ok)"
                        : t.measured === "partial"
                        ? "var(--ink-3)"
                        : "var(--warn)",
                  }}
                >
                  {t.measured === "yes" ? "有依据" : t.measured === "partial" ? "数字是拍的" : "没依据"}
                </span>
                <span className="meta" style={{ marginLeft: "auto" }}>
                  {t.file}
                </span>
              </div>
              <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.65, color: "var(--ink-2)" }}>
                {t.rationale}
              </p>
              {t.risk && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12.5,
                    lineHeight: 1.65,
                    color: "var(--muted)",
                    paddingLeft: 10,
                    borderLeft: "2px solid var(--rule-strong)",
                  }}
                >
                  改错了会怎样：{t.risk}
                </p>
              )}
            </div>
          ))}
        </div>

        <p className="meta" style={{ marginTop: 10 }}>
          ⚠️ 这张表只保证「登记的每一项都和源码一致」，保证不了「源码里所有阈值都登记了」——
          那需要真解析源码。新加影响结论的常量时要手动补进
          <code>src/data/thresholds.json</code>。
        </p>
      </section>

      {/* ── 校准记录 ─────────────────────────────── */}
      <section>
        <div className="section-head">
          Calibration Log
          <span className="n">词典改过什么、为什么</span>
        </div>
        <p className="meta" style={{ margin: "0 0 10px" }}>
          这是全项目唯一说明「为什么是这个数」的地方。不维护它，三个月后没人敢改词典。
        </p>
        <div style={{ border: "1px solid var(--rule)", padding: "12px 14px", display: "grid", gap: 7 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>
            <span className="label">适用方向</span> {DICT_META.domainLabel}
          </p>
          {DICT_META.calibration.map((line, i) => (
            <p key={i} style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: "var(--ink-2)" }}>
              {line}
            </p>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 10 }}>
          完整的「需要人工复核」清单在 <code>jd-insight/MAINTENANCE.md</code>。
        </p>
      </section>
    </div>
  );
}
