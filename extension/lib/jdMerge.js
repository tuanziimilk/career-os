/* 采集记录的键与合并规则。
 *
 * ══════════ 这个文件解决的是「重复采同一个岗位」这件事 ══════════
 *
 * 采集有两条分支：**这条是新的（插入）** 还是 **这条已经有了（更新）**。
 * 而 v2.1.1 之前的"更新"是 `jds[i] = rec` —— 整条替换。
 *
 * `rec` 是 `extract()` 从当前页面现抓的，页面上**没有**的东西它就没有：
 * 投递状态、状态轨迹、挂掉原因、你手点的意向、你手填的薪资，全都不在里面。
 * 所以一个已经标成「已投」甚至「进面」的岗位，只要再按一次 Alt+S，
 * 这些全部归零，而 toast 还显示「已更新 ·」。
 *
 * ⚠️ 而且它的后果不止"本地丢了"。追过同步链路之后（2026-09-14）：
 *   · 推送时这些字段是 undefined，`JSON.stringify` 会把键整个丢掉，
 *     PostgREST 的 merge-duplicates 只 SET 载荷里出现过的列 ——
 *     所以**云端那份没被覆盖，它还活着**
 *   · 而 `syncAll` 只拉「云端删除墓碑」和「简历」两样，**从不把状态拉回本地**
 * 于是稳定状态是：**工作台显示「已投·进面·3 条轨迹」，插件显示空白，
 * 而且下一次同步不会修复这个分歧。** 两个界面各说各话，没有任何提示。
 *
 * ══════════ 为什么单独一个文件 ══════════
 *
 * 为了能被测到。`content.js` 是内容脚本，一加载就要 DOM、要 chrome API，
 * 在 Node 里一行都跑不了 —— 逻辑留在那里等于"写完了但从没验证过"。
 * 这里只放纯函数，`scripts/eval-jd-merge.mjs` 直接 import 它。
 *
 * （同一个道理上一轮用过一次：web 端的冲突检测抽成 `lib/rowVersion.ts`
 * 也是为了能在没有真实云端的情况下构造出"另一端改过了"。）
 */

/* ── 键 ──────────────────────────────────────────────────────────── */

/** 站点前缀。现在只有 BOSS，但 ROADMAP P6 要加猎聘/智联，
    两个站的 id 空间没有理由不撞。库里只有 2 条时加前缀几乎不要钱，
    采完 100 条再加就要写数据迁移。 */
export const SITE_PREFIX = {
  "zhipin.com": "boss",
  "liepin.com": "liepin",
  "zhaopin.com": "zhaopin",
  "lagou.com": "lagou",
  "51job.com": "51job",
};

/** hostname → 前缀。认不出来的站点用 hostname 本身，
    绝不退回一个通用前缀 —— 那等于把两个站又混回同一个空间。 */
export function sitePrefix(hostname) {
  const h = String(hostname || "").replace(/^www\./, "");
  for (const domain of Object.keys(SITE_PREFIX)) {
    if (h === domain || h.endsWith("." + domain)) return SITE_PREFIX[domain];
  }
  return h || "unknown";
}

/**
 * 生成去重键。
 *
 * ⚠️ jobId 取不到时退回 URL，这是**降级**，不是正常路径。
 * v1.0 的致命 bug 正是「新版列表页所有岗位共享同一个 URL」
 * （`content.js:127` 的注释记着这件事）—— 退回 URL 意味着同一页上的
 * 多个岗位可能互相覆盖。所以 `isFallbackKey()` 存在，调用方必须据此警告。
 */
export function jdKey(hostname, jobId, url) {
  const id = String(jobId || "").trim();
  if (id) return sitePrefix(hostname) + ":" + id;
  return String(url || "").split("?")[0];
}

/** 这个键是不是降级来的（没有站点前缀 = 退回了 URL）。 */
export function isFallbackKey(key) {
  return !/^[a-z0-9.]+:[^/]/i.test(String(key || "")) || /^https?:\/\//i.test(String(key || ""));
}

/* ── 合并 ────────────────────────────────────────────────────────── */

/** 只存在于本地流转、`extract()` 永远不产出的字段。重存时一律保留旧值。
 *
 * ⚠️ 这份清单是**对着 `extract()` 的返回对象核出来的**（`content.js:798` 那个
 * 对象字面量），不是凭印象列的。`extract()` 产出：
 *   jobId / key / url / title / company / tagline / salary / salarySource /
 *   salaryParsed / salaryBlocked / salaryConflict / body / pageText / site / ts
 * 除此之外出现在记录里的字段，全部来自弹窗操作，都要保。
 *
 * ⚠️ 加新字段时必须同步这里。漏一个的表现是"那个字段每次重存就没了"，
 * 而且不报错 —— `eval-jd-merge.mjs` 里有一条断言专门盯这件事
 * （拿一条带未知字段的旧记录走一遍，未知字段必须还在）。
 */
export const LOCAL_ONLY_FIELDS = [
  "status", // 投递状态，pushStatus 写的
  "statusHistory", // 状态轨迹 + 时间戳。**丢了永远补不回来**
  "failReason", // 挂掉归因
  "intent", // 🔥/👀/❌，弹窗里手点的意向
  "salaryPending", // 待补薪资的标记
];

/** 薪资这一组必须**同进同退**。
 *
 * 手填薪资时 `popup.js` 写的是这四个 + salaryPending，一共五个字段。
 * 只保 `salary` 会造出「salary 是手填的值、salarySource 被覆盖成空、
 * salaryParsed 被覆盖成 null」这种**内部对不上**的记录 ——
 * 它不报错，只是以后按薪资排序时它悄悄排不进去。
 */
export const SALARY_FIELDS = ["salary", "salarySource", "salaryParsed", "salaryBlocked"];

/**
 * 合并一条已存在的记录。
 *
 * @param {object} old 本地已有的那条
 * @param {object} rec `extract()` 现抓的
 * @param {string} [now] 注入时间，只为测试可重复
 * @returns {object} 合并后的新记录（不改 old，也不改 rec）
 */
export function mergeJd(old, rec, now) {
  const prev = old || {};
  const next = rec || {};
  const at = now || new Date().toISOString();

  /* 手填过的薪资不许被页面抓的覆盖 —— 人填的比抓的可信，这是它存在的理由。
     这次没抓到（salaryBlocked）也保旧的：总不能因为这次没抓到就把上次
     好不容易补上的清空。 */
  const keepSalary = prev.salarySource === "手填" || !!next.salaryBlocked;

  const merged = { ...prev, ...next };

  for (const f of LOCAL_ONLY_FIELDS) {
    if (f in prev) merged[f] = prev[f];
    else delete merged[f];
  }
  if (keepSalary) {
    for (const f of SALARY_FIELDS) {
      if (f in prev) merged[f] = prev[f];
      else delete merged[f];
    }
  }

  /* 采集时间保留**首次**。理由：ts 在漏斗里被当成"这条什么时候进的库"用
     （`pipeline.js:126` 没有 statusHistory 时拿 ts 当起点），
     每次重存都刷新的话，一个采了两周、投了一周的岗位会显示成"今天刚采的"。 */
  if (prev.ts) merged.ts = prev.ts;
  merged.updatedAt = at;

  return merged;
}
