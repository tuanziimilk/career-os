/* 每条记录自己的同步水位线。纯函数，不碰 chrome.* —— 有 eval 钉着。
 *
 * ══════════ 它修的是两个同时存在的毛病 ══════════
 *
 * 之前同步的记账只有**一个全局时间戳** `lastSyncAt`，由此长出两个问题：
 *
 * 1. **同步状态那行字会少报。** `countPending` 判断"有几条没推"用的是
 *    `j.ts > lastSyncAt`，而 `ts` 是**采集时间** —— 改状态、改意向、
 *    填归因都不动它。所以标完 20 条状态之后，弹窗上显示「已是最新」，
 *    而云端那 20 条其实是旧的。**一个会撒谎的同步状态比没有更糟**：
 *    它让人以为推过了，于是不再手动同步。
 *
 * 2. **每次都全量推。** `syncAll` 遍历的是全部记录，不管改没改。
 *    13 条时无所谓，100 条就是 100 个 POST 加上有轨迹的各一次
 *    DELETE + POST，几十秒串行请求 —— 而 popup 一失焦就关，
 *    脚本上下文跟着死，同步断在半路。
 *
 * ══════════ 为什么是「每条一个水位线」而不是「全局一个」 ══════════
 *
 * 换成每条记录各记 `syncedAt` 之后，上面两条一起解决，还白拿一条：
 *
 *   · 待推数 = 有多少条 `最后修改时间 > syncedAt`，不再依赖 ts 的语义
 *   · 只推需要推的，第二次同步通常是 0 个请求
 *   · **中断变得无害** —— 已经推上去的那些自己记着，重跑接着推剩下的，
 *     不用从头再来。全局水位线做不到这点：它要么全推成功才更新，
 *     要么更新了却有记录没推上去。
 *
 * ⚠️ 时间比较一律走 Date.parse 转数字，不比字符串。
 * 现有数据里 `ts` 是 ISO（`2026-09-09T07:48:52.604Z`），字面比较碰巧也对；
 * 但 demo 数据用的是 `2026-09-09 07:48:52` 这种格式，两种混在一起时
 * 字面比较会给出无声的错误答案。
 */

/** 这条记录最后一次"内容发生变化"是什么时候。
 *  updatedAt 优先于 ts —— ts 是采集时刻，之后所有的改动都记在 updatedAt。 */
export function lastChangedAt(rec) {
  return (rec && (rec.updatedAt || rec.ts)) || "";
}

/** 打上"刚改过"的印。**任何**修改本地记录的地方都必须走它，漏一处就少报一处。 */
export function touch(rec, now) {
  return { ...rec, updatedAt: now || new Date().toISOString() };
}

/** 打上"已经推上去了"的印。 */
export function markSynced(rec, now) {
  return { ...rec, syncedAt: now || new Date().toISOString() };
}

/** 这条要不要推。
 *
 *  ⚠️ 没有 syncedAt 一律算"要推"，包括时间戳坏掉的情况。
 *  宁可多推一次（upsert 幂等，代价只是一个请求），
 *  也不要漏推 —— 漏推的后果是两个界面各说各话，而且不会报错。
 */
export function needsPush(rec) {
  if (!rec) return false;
  const synced = Date.parse(rec.syncedAt || "");
  if (!Number.isFinite(synced)) return true;
  const changed = Date.parse(lastChangedAt(rec));
  if (!Number.isFinite(changed)) return true;
  return changed > synced;
}

/** 待推的记录。给「同步状态」那行字和 syncAll 共用一个口径 ——
 *  两处各写一遍判断，迟早会出现"显示 0 条待推但点同步推了 8 条"。 */
export function pendingJobs(jobs) {
  return (jobs || []).filter(needsPush);
}
