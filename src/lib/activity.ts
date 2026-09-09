// 总览页的两个派生指标：连续学习天数、本周摘要。
// 纯函数，不碰网络——好测，也好在 console 里手验。
import type { ActivityDay, JobRecord, Status } from "./types";

function dayKey(d: Date): string {
  // 本地时区的 YYYY-MM-DD。不能用 toISOString()——那是 UTC，
  // 东八区晚上 8 点之后的学习会被算到"第二天"，连续天数直接错一天。
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function shiftDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export interface StreakResult {
  days: number;
  /** true 表示今天还没动过，连续天数是截止到昨天的。用来提醒"今天再学一下就不断" */
  endsYesterday: boolean;
}

/**
 * 连续学习天数。今天没动作不算断——只要昨天有，仍然给出截止昨天的连续数，
 * 并标记 endsYesterday，让界面能说"今天还没学"而不是直接归零。
 * 一天里学习和刷题都算"动过"，不区分。
 */
export function computeStreak(days: ActivityDay[], today = new Date()): StreakResult {
  const active = new Set(
    days.filter((d) => d.learning + d.question > 0).map((d) => d.day)
  );
  if (!active.size) return { days: 0, endsYesterday: false };

  const hasToday = active.has(dayKey(today));
  const start = hasToday ? today : shiftDays(today, -1);
  if (!active.has(dayKey(start))) return { days: 0, endsYesterday: false };

  let n = 0;
  for (let cur = start; active.has(dayKey(cur)); cur = shiftDays(cur, -1)) n += 1;
  return { days: n, endsYesterday: !hasToday };
}

export interface WeekSummary {
  applied: number;
  interviewed: number;
  offers: number;
  rejected: number;
  /** 本周之前完全没有任何状态变更记录时为 true——用来区分"这周没动"和"从来没记录过" */
  noHistoryAtAll: boolean;
}

const INTERVIEW: Status[] = ["进面", "复面"];
const REJECTED: Status[] = ["已挂", "已拒"];

/**
 * 最近 7 天的状态变更摘要。数来源是 statusHistory 的时间戳，
 * 不是当前 status——否则一个岗位三周前投的、今天还是"已投"，会被算成本周新增。
 */
export function weekSummary(jobs: JobRecord[], now = new Date()): WeekSummary {
  const since = shiftDays(now, -7).getTime();
  let applied = 0;
  let interviewed = 0;
  let offers = 0;
  let rejected = 0;
  let anyHistory = false;

  jobs.forEach((j) => {
    (j.statusHistory || []).forEach((e) => {
      anyHistory = true;
      const t = new Date(e.at.replace(" ", "T")).getTime();
      if (!Number.isFinite(t) || t < since) return;
      if (e.status === "已投") applied += 1;
      else if (INTERVIEW.includes(e.status)) interviewed += 1;
      else if (e.status === "offer") offers += 1;
      else if (REJECTED.includes(e.status)) rejected += 1;
    });
  });

  return { applied, interviewed, offers, rejected, noHistoryAtAll: !anyHistory };
}
