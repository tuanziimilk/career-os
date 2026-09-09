/* 首页 = 一张摊开的求职周报。
 *
 * 刻意不做 KPI 大数字墙：报纸的信息层级是"头条 → 版块 → 短讯"，
 * 头条必须是**今天要做的事**（待跟进），而不是"累计投递 8 条"这种
 * 看了不改变任何行为的数字。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ActivityDay, DataSource, JobRecord, LearningModule } from "../lib/types";
import { computeFunnel, needsFollowUp } from "../lib/funnel";
import { computeStreak, weekSummary } from "../lib/activity";
import { Stamp, statusStamp } from "../components/Stamp";

export function Overview({ source }: { source: DataSource }) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [modules, setModules] = useState<LearningModule[]>([]);
  const [activity, setActivity] = useState<ActivityDay[] | null>(null);

  useEffect(() => {
    source.getJobs().then(setJobs);
    source.getLearning().then(setModules);
    if (source.getActivityDays) source.getActivityDays().then(setActivity);
    else setActivity(null);
  }, [source]);

  const funnel = computeFunnel(jobs);
  const followUps = needsFollowUp(jobs);
  const doneCount = modules.filter((m) => m.status === "能空手讲").length;
  const streak = computeStreak(activity || []);
  const week = weekSummary(jobs);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── 头条：今天要做什么 ───────────────────────── */}
      <section>
        <div className="section-head">
          Today&apos;s Brief
          <span className="n">今日待办</span>
        </div>

        {followUps.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>
            没有沉默超过 14 天的岗位。
            <span className="annot" style={{ marginLeft: 8 }}>— 干净的桌面</span>
          </p>
        ) : (
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0 }}>
              <h2 style={{ fontSize: 25, lineHeight: 1.2, marginBottom: 10 }}>
                {followUps.length} 个岗位在等你跟进
              </h2>
              <div style={{ display: "grid", gap: 0 }}>
                {followUps.map((f) => {
                  const st = statusStamp(f.status);
                  return (
                    <div
                      key={f.key}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 9,
                        padding: "7px 0",
                        borderTop: "1px solid var(--rule)",
                      }}
                    >
                      <span style={{ fontSize: 14.5, fontWeight: 600 }}>
                        {f.title}
                      </span>
                      <span className="meta">{f.company}</span>
                      <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                        <Stamp tone={st.tone}>{st.text}</Stamp>
                        <span className="meta-strong" style={{ color: "var(--red)" }}>
                          {f.silentFor}D
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="sticky"
              style={{ padding: "12px 14px", flex: "0 0 auto", maxWidth: 190 }}
            >
              <div className="refno" style={{ color: "#6b5c14" }}>
                Action needed
              </div>
              <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>
                投出去 14 天没动静，基本就是没下文了。要么补一封跟进，要么标记挂掉腾出注意力。
              </p>
              <Link
                to="/pipeline"
                style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "#6b5c14" }}
              >
                去投递页 →
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* ── 本周 ─────────────────────────────────────── */}
      <section>
        <div className="section-head">
          This Week
          <span className="n">近 7 天 · 按状态变更时间统计</span>
        </div>
        {week.noHistoryAtAll ? (
          <p className="meta">
            还没有任何状态变更记录。在扩展里改一次状态，或在
            <Link to="/pipeline"> 投递页 </Link>
            编辑一条。
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
              gap: 0,
              borderTop: "1px solid var(--rule)",
              borderBottom: "1px solid var(--rule)",
            }}
          >
            {(
              [
                ["新投递", week.applied],
                ["进面", week.interviewed],
                ["Offer", week.offers],
                ["挂 / 拒", week.rejected],
              ] as [string, number][]
            ).map(([label, n], i) => (
              <div
                key={label}
                style={{
                  padding: "11px 12px",
                  borderLeft: i === 0 ? 0 : "1px solid var(--rule)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: 30,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: n === 0 ? "var(--ink-3)" : "var(--ink)",
                  }}
                >
                  {n}
                </div>
                <div className="label" style={{ marginTop: 3 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 桌面短讯：漏斗 / 学习 ─────────────────────── */}
      <section>
        <div className="section-head">
          On The Desk
          <span className="n">档案概览</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14,
          }}
        >
          <DeskCard
            to="/pipeline"
            no="AP"
            en="Applications"
            big={String(funnel.applied)}
            unit="条已投"
            note={
              funnel.silentRate == null
                ? "还没有可算的沉默率"
                : `沉默率 ${Math.round(funnel.silentRate * 100)}% · 回音中位 ${
                    funnel.replyMedianDays == null ? "—" : funnel.replyMedianDays + " 天"
                  }`
            }
          />
          <DeskCard
            to="/learning"
            no="LM"
            en="Learning Map"
            big={modules.length ? `${doneCount}/${modules.length}` : "—"}
            unit="能空手讲"
            note={
              activity == null
                ? "当前数据源没有活动记录"
                : streak.days === 0
                  ? "今天标记一个模块就开始了"
                  : `连续 ${streak.days} 天${streak.endsYesterday ? "（截止昨天）" : ""}`
            }
          />
          <DeskCard
            to="/practice"
            no="FN"
            en="Field Notes"
            big="→"
            unit="面试题库"
            note="按模块刷题，标记会 / 模糊 / 不会"
          />
        </div>
      </section>

      <p className="meta" style={{ lineHeight: 1.7, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
        JD 采集与打标交给浏览器扩展 jd-insight —— 它是剪刀，这里是档案室。
      </p>
    </div>
  );
}

function DeskCard({
  to,
  no,
  en,
  big,
  unit,
  note,
}: {
  to: string;
  no: string;
  en: string;
  big: string;
  unit: string;
  note: string;
}) {
  return (
    <Link
      to={to}
      className="clipping"
      style={{
        display: "block",
        padding: "12px 13px 13px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div className="refno" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{en}</span>
        <span style={{ color: "var(--ink-3)" }}>{no}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "7px 0 5px" }}>
        <span style={{ fontFamily: "var(--serif)", fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
          {big}
        </span>
        <span className="label">{unit}</span>
      </div>
      <div className="label" style={{ lineHeight: 1.5 }}>
        {note}
      </div>
    </Link>
  );
}
