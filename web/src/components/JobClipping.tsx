/* 岗位剪报。招聘启事从报纸上剪下来贴在墙上的样子。
 *
 * 为什么岗位用"剪贴"而不是"纸卡"：它们确实是从别处剪下来的——
 * jd-insight 扩展就是那把剪刀。视觉隐喻和数据来源对上了，
 * 这条才叫设计，而不是给卡片换个边框。
 *
 * 排版刻意做成分类广告栏（classified ads）的密度：
 * 岗位名用衬线、公司和地点用小号 sans、薪资和日期用等宽。
 */
import type { JobRecord } from "../lib/types";
import { formatSalary } from "../lib/salary";
import { daysSince, enteredAt } from "../lib/funnel";
import { Stamp, statusStamp } from "./Stamp";

export function JobClipping({ job, onEdit }: { job: JobRecord; onEdit?: () => void }) {
  const st = statusStamp(job.status);
  const silent = daysSince(enteredAt(job, job.status));
  const stale = silent != null && silent >= 14 && !["已挂", "已拒", "offer"].includes(job.status);

  return (
    <article
      className="clipping"
      style={{ padding: "12px 13px 11px", display: "grid", gap: 6 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3
            style={{
              fontSize: 15,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
            }}
          >
            {job.intent === "🔥" && (
              <span
                title="想投"
                style={{ color: "var(--red)", fontFamily: "var(--mono)", fontSize: 12, marginRight: 5 }}
              >
                ★
              </span>
            )}
            {job.title || "（无标题）"}
          </h3>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>
            {job.company || <span className="annot">公司名未抓到</span>}
          </div>
        </div>
        <Stamp tone={st.tone} title={"状态：" + (job.status || "仅采集")}>
          {st.text}
        </Stamp>
      </div>

      {job.tagline && (
        <div className="meta" style={{ borderTop: "1px solid var(--rule)", paddingTop: 5 }}>
          {job.tagline}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          className="meta-strong"
          style={{ fontSize: 12.5, color: job.salaryParsed ? "var(--ink)" : "var(--ink-3)" }}
          title={job.salarySource ? "薪资来源：" + job.salarySource : undefined}
        >
          {job.salaryParsed
            ? formatSalary({ raw: job.salary, parsed: true, ...job.salaryParsed })
            : job.salary
              ? "~" + job.salary
              : "薪资待补"}
        </span>

        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {stale && (
            <span className="annot" style={{ fontSize: 12 }}>
              沉默 {silent} 天
            </span>
          )}
          {onEdit && (
            <button
              className="ghost"
              onClick={onEdit}
              style={{ padding: "3px 7px", fontSize: 9.5, borderWidth: 1 }}
            >
              Edit
            </button>
          )}
        </span>
      </div>
    </article>
  );
}
