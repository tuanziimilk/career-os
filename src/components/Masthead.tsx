/* 报头 THE CAREER DESK。
 *
 * 期号刻意用真实数据算：以 2026-09-08（第一条 JD 采集日）为第 1 期，
 * 每过一周一期。这样"ISSUE No. 014"是可核对的事实而不是装饰——
 * 一个假的期号迟早会被自己看穿，然后整套视觉的可信度一起掉。
 */
import type { DataSource } from "../lib/types";

const EPOCH = new Date(2026, 8, 8); // 2026-09-08，项目开始那天
const WEEK = 7 * 864e5;

const WEEKDAY_EN = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function Masthead({ section, source }: { section: string; source: DataSource }) {
  const now = new Date();
  const issue = Math.max(1, Math.floor((now.getTime() - EPOCH.getTime()) / WEEK) + 1);
  const dateline =
    WEEKDAY_EN[now.getDay()] +
    " · " +
    MONTH_EN[now.getMonth()] +
    " " +
    String(now.getDate()).padStart(2, "0") +
    " · ISSUE No. " +
    String(issue).padStart(3, "0");

  return (
    <header style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          paddingBottom: 7,
          borderBottom: "3px double var(--ink)",
        }}
      >
        <h1
          style={{
            fontSize: 34,
            letterSpacing: "0.01em",
            lineHeight: 1,
            textTransform: "uppercase",
          }}
        >
          The Career Desk
        </h1>
        <div style={{ textAlign: "right" }}>
          <div className="refno" style={{ color: "var(--ink-3)" }}>
            Current Status
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--red)",
            }}
          >
            SEO → AI / GROWTH
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          paddingTop: 5,
        }}
      >
        <span className="meta" style={{ letterSpacing: "0.1em" }}>
          {dateline}
        </span>
        <span className="meta" style={{ letterSpacing: "0.1em" }}>
          {section} · {source.label}
        </span>
      </div>
    </header>
  );
}
