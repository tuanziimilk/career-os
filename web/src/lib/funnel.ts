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

/** 主线：点一下前进一档。**不含终止态**。
 *  为什么拆开、以及原来的循环点击怎么在伪造求职经历，
 *  见 `extension/lib/pipeline.js` 同名常量上方那段。 */
export const MAIN_CYCLE: Status[] = ["", "想投", "已投", "进面", "复面", "offer"];

export interface FailGroup {
  id: string;
  label: string;
  countsAsFailure: boolean;
}
export interface FailReason {
  id: string;
  group: string;
  hint: string;
}

/** 挂掉的归因。2026-09-16 重做 —— 原来的桶把「挂在哪一环」和「为什么挂」
 *  混在一起，既冗余（阶段已经在 statusHistory 里）又不够（缺「没有回音」）。
 *  完整理由写在 `extension/lib/pipeline.js` 的同名常量上方。
 *
 *  ⚠️ 两端必须逐字一致，`check-shared.mjs` 第三节会校验。 */
export const FAIL_GROUPS: FailGroup[] = [
  { id: "待改进", label: "可以改的", countsAsFailure: true },
  { id: "外部", label: "外部因素", countsAsFailure: false },
  { id: "我的选择", label: "我的选择", countsAsFailure: false },
  { id: "待定", label: "还没想清楚", countsAsFailure: false },
];

export const FAIL_REASONS: FailReason[] = [
  { id: "没有回音", group: "待改进", hint: "投了之后一直没动静" },
  { id: "明确拒信", group: "待改进", hint: "收到拒信但没说原因 —— 至少说明简历被人看过" },
  { id: "背景不符", group: "待改进", hint: "学历/年限/行业硬门槛。这是我自己的判断，未必是对方的理由" },
  { id: "技术被问穿", group: "待改进", hint: "对方追问细节，我确实不知道" },
  { id: "讲不明白", group: "待改进", hint: "我知道，但没讲清楚；事后想想能答" },
  { id: "方向不匹配", group: "待改进", hint: "双方都觉得不是一路的" },
  { id: "薪资没谈拢", group: "待改进", hint: "" },
  { id: "岗位没了", group: "外部", hint: "HC 冻结 / 岗位关闭 / 转内推" },
  { id: "我主动退出", group: "我的选择", hint: "流程还在，但我不想继续了" },
  { id: "我拒了 offer", group: "我的选择", hint: "" },
  { id: "还不知道", group: "待定", hint: "先标上，想明白再回来补" },
];

export const FAIL_BUCKETS = FAIL_REASONS.map((r) => r.id);

/** 这条归因算不算「我的失败」。外部因素和我主动的选择都不算。 */
export function countsAsFailure(reason: string): boolean {
  const r = FAIL_REASONS.find((x) => x.id === reason);
  if (!r) return true;
  const g = FAIL_GROUPS.find((x) => x.id === r.group);
  return g ? g.countsAsFailure : true;
}

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
/** 这条记录挂在哪一档 —— 从 statusHistory 推断。
 *  ⚠️ 它会经常推不准（没逐档标记时会偏向早期阶段），调用方必须允许人改。
 *  理由写在 `extension/lib/pipeline.js` 的同名函数上方。 */
export function endedAtStage(rec: JobRecord): Status {
  const hist = rec.statusHistory || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const s = (hist[i].status || "") as Status;
    if (!isTerminal(s)) return s;
  }
  const cur = (rec.status || "") as Status;
  return isTerminal(cur) ? "" : cur;
}

export interface FailBreakdown {
  rows: [string, number][];
  groups: { id: string; label: string; count: number; countsAsFailure: boolean }[];
  total: number;
  failures: number;
  notMyFault: number;
  unknown: number;
}

/** 挂掉归因的统计。**按组聚合，不是简单计数** ——
 *  「岗位 HC 冻结了」和「我技术被问穿了」对复盘的指向完全相反，
 *  混在一起会让漏斗显得比实际难看。 */
export function failBreakdown(records: JobRecord[]): FailBreakdown {
  const m: Record<string, number> = {};
  let total = 0;
  (records || []).forEach((r) => {
    if (!isTerminal(r.status)) return;
    total += 1;
    // 没写归因的一律算成「还不知道」，不另立「未归因」桶 —— 两者是同一件事
    const k = r.failReason || "还不知道";
    m[k] = (m[k] || 0) + 1;
  });

  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]) as [string, number][];

  const groups = FAIL_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    countsAsFailure: g.countsAsFailure,
    count: rows.reduce((n, [reason, c]) => {
      const def = FAIL_REASONS.find((x) => x.id === reason);
      const gid = def ? def.group : "待改进";
      return gid === g.id ? n + c : n;
    }, 0),
  }));

  const sum = (pred: (g: (typeof groups)[number]) => boolean) =>
    groups.filter(pred).reduce((n, g) => n + g.count, 0);

  return {
    rows,
    groups,
    total,
    failures: sum((g) => g.countsAsFailure),
    notMyFault: sum((g) => !g.countsAsFailure && g.id !== "待定"),
    unknown: sum((g) => g.id === "待定"),
  };
}
