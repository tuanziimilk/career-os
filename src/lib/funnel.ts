// 投递漏斗指标计算。
// 这是 jd-insight/extension/lib/pipeline.js 的 TypeScript 移植版——
// 同一套已经实测验证过的算法，包括那个真实踩过的建模坑：
// "想投"是可跳过的标记阶段，不是必经阶段，逐级转化率必须跳过它计算，
// 否则会出现"转化率 150%"这种荒谬结果（已投 3 条 / 想投 2 条）。
import type { JobRecord, Status, StatusEvent } from "./types";

export interface Stage {
  id: Status;
  label: string;
  short: string;
  optional?: boolean;
}

export const STAGES: Stage[] = [
  { id: "", label: "已采集", short: "采集" },
  { id: "想投", label: "想投", short: "想投", optional: true },
  { id: "已投", label: "已投递", short: "已投" },
  { id: "进面", label: "进入面试", short: "进面" },
  { id: "复面", label: "复面/多轮", short: "复面" },
  { id: "offer", label: "拿到 Offer", short: "offer" },
];

export const TERMINAL: Status[] = ["已挂", "已拒"];
export const STATUS_CYCLE: Status[] = ["", "想投", "已投", "进面", "复面", "offer", "已挂", "已拒"];

export const FAIL_BUCKETS = [
  "简历没过",
  "笔试挂",
  "一面挂-项目深挖",
  "一面挂-概念不熟",
  "一面挂-表达散",
  "二面挂",
  "薪资谈崩",
  "我主动放弃",
  "岗位关闭",
];

export function isTerminal(status: Status): boolean {
  return TERMINAL.includes(status);
}

const DAY = 86400000;

function parseAt(s?: string): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

export function enteredAt(rec: JobRecord, status: Status): number | null {
  const e = rec.statusHistory.find((x) => x.status === status);
  return e ? parseAt(e.at) : null;
}

export function daysSince(ts: number | null): number | null {
  if (ts == null) return null;
  return Math.floor((Date.now() - ts) / DAY);
}

function median(arr: number[]): number | null {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export interface FunnelRow extends Stage {
  count: number;
  rate: number | null; // 逐级转化率，optional 阶段恒为 null
  fromTop: number | null; // 占顶端（已采集）的比例
}

export interface FunnelResult {
  rows: FunnelRow[];
  applied: number;
  terminal: number;
  silent: number;
  silentRate: number | null;
  replyMedianDays: number | null;
  silentDays: number;
}

/**
 * 指标定义：
 *   到达数     = 曾经进入过该阶段的条数（看历史，不看"当前状态"）
 *                —— 用"曾经到达"而不是"当前停留"，否则已挂的岗位会从漏斗里消失，
 *                   漏斗会显得比真实情况漂亮。
 *   逐级转化率 = 本阶段到达数 / 上一个"必经阶段"到达数（跳过 optional 标记阶段）
 *   沉默率     = 已投且距今 >= silentDays 天、且从未进面 / 已投总数
 *                —— 求职里最真实的一个指标：多数时候没有拒信，只有沉默。
 *   回音中位数 = 从"已投"到下一次状态变更的天数中位数（仅统计有变更的）
 */
export function computeFunnel(records: JobRecord[], silentDays = 14): FunnelResult {
  const reached: Record<string, number> = {};
  STAGES.forEach((s) => (reached[s.id] = 0));

  const replyDays: number[] = [];
  let silent = 0;
  let applied = 0;
  let terminalCount = 0;

  records.forEach((r) => {
    const hist: StatusEvent[] =
      r.statusHistory.length > 0
        ? r.statusHistory
        : r.status
          ? [{ status: r.status, at: r.ts }]
          : [];
    const seen = new Set<string>(hist.map((h) => h.status));
    if (r.status) seen.add(r.status);
    seen.add(""); // 采集本身就是第 0 阶段
    STAGES.forEach((s) => {
      if (seen.has(s.id)) reached[s.id] += 1;
    });

    if (isTerminal(r.status)) terminalCount += 1;

    const at投 = enteredAt(r, "已投");
    if (at投 != null) {
      applied += 1;
      const after = hist.filter((h) => (parseAt(h.at) ?? 0) > at投);
      if (after.length) {
        replyDays.push(Math.floor(((parseAt(after[0].at) ?? 0) - at投) / DAY));
      } else if (!seen.has("进面") && (daysSince(at投) ?? 0) >= silentDays) {
        silent += 1;
      }
    }
  });

  const rows: FunnelRow[] = STAGES.map((s, i) => {
    const n = reached[s.id];
    let prev: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!STAGES[j].optional) {
        prev = reached[STAGES[j].id];
        break;
      }
    }
    return {
      ...s,
      count: n,
      rate: s.optional || !prev ? null : n / prev,
      fromTop: reached[STAGES[0].id] ? n / reached[STAGES[0].id] : null,
    };
  });

  return {
    rows,
    applied,
    terminal: terminalCount,
    silent,
    silentRate: applied ? silent / applied : null,
    replyMedianDays: median(replyDays),
    silentDays,
  };
}

export interface FollowUpItem extends JobRecord {
  silentFor: number;
}

/** 待跟进：投了很久没动静的，按沉默天数降序——工作台最该显眼的一块 */
export function needsFollowUp(records: JobRecord[], silentDays = 14): FollowUpItem[] {
  return records
    .map((r) => ({ r, at: enteredAt(r, "已投") }))
    .filter(({ r, at }) => at != null && !r.statusHistory.some((h) => h.status === "进面"))
    .map(({ r, at }) => ({ ...r, silentFor: daysSince(at) ?? 0 }))
    .filter((r) => r.silentFor >= silentDays && !isTerminal(r.status))
    .sort((a, b) => b.silentFor - a.silentFor);
}

/** 挂掉原因分桶，按数量降序 */
export function failBreakdown(records: JobRecord[]): [string, number][] {
  const m: Record<string, number> = {};
  records.forEach((r) => {
    if (!isTerminal(r.status)) return;
    const k = r.failReason || "未归因";
    m[k] = (m[k] || 0) + 1;
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
