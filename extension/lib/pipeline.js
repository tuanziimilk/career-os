/* 投递漏斗的数据模型与指标定义
 *
 * ⚠️ 核心决策：**状态变更必须记时间戳，不能只存当前状态。**
 *   「当前状态」只能算转化率；「回音时长」「沉默率」「投递到 offer 的周期」
 *   都需要知道每次变更发生在什么时候。而**时间戳一旦没记就永远补不回来**——
 *   等投了 30 个岗再想做漏斗，只能看到一堆「已挂」，不知道各自挂在第几天。
 *
 *   所以这一层先于看板落地：哪怕图还没画，数据得先开始攒。
 */

/** 漏斗阶段。顺序即漏斗顺序，索引用于判断"是否到达过某阶段" */
export const STAGES = [
  { id: "", label: "已采集", short: "采集" },
  // ⚠️ optional=可跳过的标记阶段。逐级转化率必须跳过它，
  //    否则会算出「转化率 150%」——因为有些岗位直接从采集跳到已投，
  //    从没标过「想投」，分母比分子小。（v2.2.0 实测发现）
  { id: "想投", label: "想投", short: "想投", optional: true },
  { id: "已投", label: "已投递", short: "已投" },
  { id: "进面", label: "进入面试", short: "进面" },
  { id: "复面", label: "复面/多轮", short: "复面" },
  { id: "offer", label: "拿到 Offer", short: "offer" },
];

/** 终止态：不算流失，单独统计
 *
 * ⚠️ 2026-09-11 删掉了第三项 `"不考虑"`。它是**从来不可能命中的死项**：
 * 「不考虑」不是投递状态，是**意向**（popup 里存成 `"❌"`，
 * `INTENT_LABEL` 把它显示成「不考虑」）。而 TERMINAL 是拿来和 `r.status` 比的，
 * status 的取值只有 STATUS_CYCLE 那八个，永远不等于「不考虑」。
 *
 * 删它的理由不是它有 bug（它没造成任何错误行为），
 * 是它**在说一件不成立的事** —— 让人以为模型里有这么一个终止态。
 * 而 funnel.ts 那边（TS 移植版）本来就没有它，两端因此对不上。
 * 这个分叉是 2026-09-11 新加的 check-shared 第三节第一次跑就抓出来的。
 */
export const TERMINAL = ["已挂", "已拒"];

export const STATUS_CYCLE = ["", "想投", "已投", "进面", "复面", "offer", "已挂", "已拒"];

/** 主线：点一下前进一档。**不含终止态** —— 那是 2026-09-16 改掉的核心。
 *
 * ⚠️ 原来的交互是拿 STATUS_CYCLE（含终止态）做循环点击，后果不是"不好用"，
 * 是**在伪造求职经历**：要把一条标成「已拒」得点 7 下，而 pushStatus
 * 每一下都写一条带时间戳的历史，于是漏斗认为这条岗位
 * 「曾经到达过 已投 / 进面 / 复面 / offer」——
 * 实测一条从没投过的记录会被算进 applied=1、offer=1。
 *
 * 它坏得最难发现：不报错、轨迹看起来是条正常的求职路径、
 * 时间戳全在同一秒但没有任何东西会提醒你。
 *
 * 所以拆成两个控件：主线点击前进（最多到 offer），终止态走单独的「挂了」，
 * 一步到位 + 当场归因。
 */
export const MAIN_CYCLE = ["", "想投", "已投", "进面", "复面", "offer"];

/** 挂掉的归因。
 *
 * ══════════ 为什么重做（2026-09-16）══════════
 *
 * 原来的桶把**两个维度混在一起**：
 *   简历没过 / 笔试挂 / 一面挂-X / 二面挂   ← 阶段（有的还带原因）
 *   薪资谈崩 / 我主动放弃 / 岗位关闭        ← 纯原因
 *
 * 而「挂在哪一环」**已经在 statusHistory 里了**，不该再问一遍。
 * 于是这张表既冗余（重复记阶段）又不够 —— 缺的全是纯原因，
 * 其中最要命的是**「没有回音」**：求职里最常见的结局，
 * 原来只能归进「简历没过」，而那是猜的。
 *
 * 现在：阶段由 `endedAtStage()` 推断（并允许人改），归因只问「为什么」。
 *
 * ══════════ 分组的意义不是好看 ══════════
 *
 * `外部` 和 `我的选择` 这两组**不该算进失败率**。
 * 混在一起统计，会让漏斗显得比实际难看 —— 而"岗位 HC 冻结了"
 * 和"我技术被问穿了"对复盘的指向完全相反。
 * `failBreakdown()` 因此按组聚合，不是简单计数。
 *
 * ⚠️ `待定` 组只有「还不知道」一条，它是**一等选项不是兜底**：
 * 求职里大量情况就是不知道为什么挂。强制归因的后果是乱选，
 * 而乱选的数据比没有数据糟 —— 它让漏斗看起来有依据，实际全是随手点的。
 * 所以宁可显式记「还不知道」，界面上还能数出"有几条待补"。
 *
 * ⚠️ `hint` 不是装饰。「技术被问穿」和「讲不明白」在纸面上很清楚，
 * 实际复盘时经常分不出来（被问穿的表现往往就是讲不清）。
 * 分不清就会随便选，两个桶互相污染，最后"该补技术还是练表达"的统计是假的。
 * 所以每条给一个**可操作的判据**，选的时候照着对。
 */
export const FAIL_GROUPS = [
  { id: "待改进", label: "可以改的", countsAsFailure: true },
  { id: "外部", label: "外部因素", countsAsFailure: false },
  { id: "我的选择", label: "我的选择", countsAsFailure: false },
  { id: "待定", label: "还没想清楚", countsAsFailure: false },
];

/* 顺序 = 界面上的顺序，按**真实频率**排，不按逻辑分类排。
   「没有回音」大概率占一半以上，它必须在第一个 ——
   选项越多越容易乱选，而把最常见的放最前能少点很多下。 */
export const FAIL_REASONS = [
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

/** 兼容用：只要 id 的扁平数组。工作台的下拉列表和 check-shared 都用它。 */
export const FAIL_BUCKETS = FAIL_REASONS.map((r) => r.id);

/** 这条归因算不算「我的失败」。外部因素和我主动的选择都不算。 */
export function countsAsFailure(reason) {
  const r = FAIL_REASONS.find((x) => x.id === reason);
  if (!r) return true; // 自由填写的归因保守算进失败
  const g = FAIL_GROUPS.find((x) => x.id === r.group);
  return g ? g.countsAsFailure : true;
}

export function isTerminal(status) {
  return TERMINAL.includes(status);
}

/**
 * 追加一次状态变更。**只在状态真的变了时候写历史**，避免重复点击刷出噪声。
 * @returns 新的 record（不改原对象）
 */
export function pushStatus(rec, status) {
  const prev = rec.status || "";
  if (prev === status) return rec;
  const hist = Array.isArray(rec.statusHistory) ? rec.statusHistory.slice() : [];
  // 第一次记录时，把"采集时刻"补成起点，否则算不出第一段时长
  if (!hist.length) {
    hist.push({ status: prev, at: rec.ts || new Date().toISOString() });
  }
  hist.push({ status, at: new Date().toISOString() });
  return { ...rec, status, statusHistory: hist };
}

const DAY = 86400000;

function parseAt(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

/** 某条记录进入某状态的时间 */
export function enteredAt(rec, status) {
  const h = rec.statusHistory || [];
  const e = h.find((x) => x.status === status);
  return e ? parseAt(e.at) : null;
}

/** 距今多少天（向下取整） */
export function daysSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / DAY);
}

function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * 漏斗指标。
 *
 * 指标定义（写清楚，否则看板上的数字没人知道怎么来的）：
 *   到达数      = 曾经进入过该阶段的条数（看历史，不看当前状态）
 *                 —— 用"曾经到达"而不是"当前停留"，否则已挂的岗位会从漏斗里消失
 *   转化率      = 本阶段到达数 / 上一阶段到达数
 *   沉默率      = 已投且距今 >= silentDays 天、且从未进面 / 已投总数
 *                 —— 这是求职里最真实的一个指标：没有拒信，只有沉默
 *   回音中位数  = 从"已投"到下一次状态变更的天数中位数（仅统计有变更的）
 */
export function funnel(records, opts = {}) {
  const silentDays = opts.silentDays || 14;
  const reached = {};
  STAGES.forEach((s) => (reached[s.id] = 0));

  const replyDays = [];
  let silent = 0, applied = 0, terminal = 0;

  records.forEach((r) => {
    const hist = r.statusHistory || (r.status ? [{ status: r.status, at: r.ts }] : []);
    const seen = new Set(hist.map((h) => h.status));
    // 当前状态也算到达过
    if (r.status) seen.add(r.status);
    seen.add(""); // 采集本身就是第 0 阶段
    STAGES.forEach((s) => { if (seen.has(s.id)) reached[s.id] += 1; });

    if (isTerminal(r.status)) terminal += 1;

    const at投 = enteredAt(r, "已投");
    if (at投) {
      applied += 1;
      // 投递之后有没有变更
      const after = (hist || []).filter((h) => parseAt(h.at) > at投);
      if (after.length) {
        replyDays.push(Math.floor((parseAt(after[0].at) - at投) / DAY));
      } else if (!seen.has("进面") && daysSince(at投) >= silentDays) {
        silent += 1;
      }
    }
  });

  const rows = STAGES.map((s, i) => {
    const n = reached[s.id];
    // 逐级转化率：分母取上一个**必经**阶段（跳过 optional 的标记阶段）
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!STAGES[j].optional) { prev = reached[STAGES[j].id]; break; }
    }
    return {
      ...s,
      count: n,
      // optional 阶段不给逐级转化率——它不是漏斗的一环，是个筛选标记
      rate: s.optional || !prev ? null : n / prev,
      fromTop: reached[STAGES[0].id] ? n / reached[STAGES[0].id] : null,
    };
  });

  return {
    rows,
    applied,
    terminal,
    silent,
    silentRate: applied ? silent / applied : null,
    replyMedianDays: median(replyDays),
    silentDays,
  };
}

/** 待跟进：投了很久没动静的，按沉默天数排 —— 工作台最该显眼的一块 */
export function needsFollowUp(records, silentDays = 14) {
  return records
    .map((r) => ({ r, at: enteredAt(r, "已投") }))
    .filter((x) => x.at && !x.r.statusHistory?.some((h) => h.status === "进面"))
    .map((x) => ({ ...x.r, _silentFor: daysSince(x.at) }))
    .filter((x) => x._silentFor >= silentDays && !isTerminal(x.status))
    .sort((a, b) => b._silentFor - a._silentFor);
}

/** 这条记录挂在哪一档 —— 从 statusHistory 里推断，不再问人。
 *
 * ⚠️ **它会经常推不准，这是设计上已知的洞，不是 bug。**
 *
 * 前提是你逐档标记过。而真实情况常常是：投完 → 过两周面了一次 → 挂了。
 * 中间没点过「进面」的话，历史里只有 `已投 → 已挂`，
 * 这个函数就会说"挂在已投"，而实际你面到了一面。
 * **归因会因此系统性偏向早期阶段。**
 *
 * 所以调用方（popup 的「挂了」流程）必须把推断结果**显示出来并允许一键改**——
 * 不是重新问一遍，是让人在它猜错时能纠正。
 *
 * @returns {string} 阶段 id（"" / 想投 / 已投 / 进面 / 复面 / offer），
 *                   没有任何历史时返回 ""
 */
export function endedAtStage(rec) {
  const hist = (rec && rec.statusHistory) || [];
  // 倒着找第一个非终止态 —— 那就是它挂之前停在哪
  for (let i = hist.length - 1; i >= 0; i--) {
    const s = hist[i].status || "";
    if (!isTerminal(s)) return s;
  }
  // 没有历史：拿当前状态兜底（它本身不是终止态的话）
  const cur = (rec && rec.status) || "";
  return isTerminal(cur) ? "" : cur;
}

/** 挂掉归因的统计。**按组聚合，不是简单计数。**
 *
 * ⚠️ 为什么不能一视同仁：「岗位 HC 冻结了」和「我技术被问穿了」
 * 对复盘的指向完全相反，混在一张表里会让漏斗显得比实际难看。
 * 所以 `外部` / `我的选择` / `待定` 三组**不计入失败率**。
 *
 * @returns {{
 *   rows: [string, number][],          // 逐条计数，降序（兼容旧调用方）
 *   groups: {id,label,count,countsAsFailure}[],
 *   failures: number,                  // 只算「可以改的」那一组
 *   notMyFault: number,                // 外部 + 我的选择
 *   unknown: number,                    // 待定（界面该提醒你回来补）
 *   total: number
 * }}
 */
export function failBreakdown(records) {
  const m = {};
  let total = 0;
  (records || []).forEach((r) => {
    if (!isTerminal(r.status)) return;
    total += 1;
    /* ⚠️ 没写归因的一律算成「还不知道」，不另立一个「未归因」桶。
       两者在复盘上是同一件事，而多一个桶会让人以为它们有区别。 */
    const k = r.failReason || "还不知道";
    m[k] = (m[k] || 0) + 1;
  });

  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);

  const groups = FAIL_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    countsAsFailure: g.countsAsFailure,
    count: rows.reduce((n, [reason, c]) => {
      const def = FAIL_REASONS.find((x) => x.id === reason);
      /* 自由填写的归因（不在表里）保守归进「可以改的」——
         宁可高估自己的问题，也不要把它算成外部因素而看不见。 */
      const gid = def ? def.group : "待改进";
      return gid === g.id ? n + c : n;
    }, 0),
  }));

  const sum = (pred) => groups.filter(pred).reduce((n, g) => n + g.count, 0);

  return {
    rows,
    groups,
    total,
    failures: sum((g) => g.countsAsFailure),
    notMyFault: sum((g) => !g.countsAsFailure && g.id !== "待定"),
    unknown: sum((g) => g.id === "待定"),
  };
}
