/* 同步水位线的断言。
 *
 *     node jd-insight/scripts/eval-sync-state.mjs
 *
 * ══════════ 核心断言只有一条 ══════════
 *
 *   **改过状态的记录，必须被算进「待推」。**
 *
 * 旧实现比的是 `j.ts > lastSyncAt`，而 `ts` 是**采集时间** ——
 * 改状态 / 改意向 / 填归因都不动它。于是标完一批状态之后，
 * 弹窗上显示「已是最新」，而云端那批状态还是旧的。
 *
 * 这个 bug 的性质和 eval-status-model 那条一样：**不报错，而且会误导行动**。
 * 一个会撒谎的同步状态比没有更糟 —— 它让人以为推过了，于是不再手动同步，
 * 最后两个界面各说各话。
 *
 * ⚠️ 写的时候先对着旧判据（下面 legacyPending）跑过，确认第 1 组是红的，
 * 再改的代码。
 */
import {
  lastChangedAt,
  touch,
  markSynced,
  needsPush,
  pendingJobs,
} from "../extension/lib/syncState.js";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}
function group(t) {
  console.log("");
  console.log(t);
}

const T0 = "2026-09-01T00:00:00.000Z"; // 采集
const T1 = "2026-09-05T00:00:00.000Z"; // 同步
const T2 = "2026-09-09T00:00:00.000Z"; // 改状态

/** 旧判据，留着当对照组：只看采集时间和全局同步时间。 */
function legacyPending(jobs, lastSyncAt) {
  return (jobs || []).filter((j) => j.ts && j.ts > lastSyncAt);
}

/* ─────────────────────────────────────────── 1. 核心（旧实现在这组红） */
group("1. 改过状态的记录必须算进待推");

// 一条 9/1 采集、9/5 推过、9/9 改了状态的记录
const edited = markSynced({ key: "a", ts: T0, status: "已投" }, T1);
const editedThenTouched = touch(edited, T2);

check(
  "【复现旧 bug】旧判据看不见它（ts 还是 9/1，早于 9/5 那次同步）",
  legacyPending([editedThenTouched], T1).length === 0,
  "旧判据算出 " + legacyPending([editedThenTouched], T1).length + " 条待推"
);
check(
  "新判据看得见",
  needsPush(editedThenTouched) === true && pendingJobs([editedThenTouched]).length === 1
);

check(
  "推完之后就不该再算待推",
  needsPush(markSynced(editedThenTouched, "2026-09-10T00:00:00.000Z")) === false
);
check("没改过的不算待推", needsPush(edited) === false);

/* ─────────────────────────────────────────── 2. 边界 */
group("2. 边界：宁可多推，不可漏推");

check("从没推过（没有 syncedAt）→ 要推", needsPush({ key: "b", ts: T0 }) === true);
check("syncedAt 是坏值 → 要推", needsPush({ key: "c", ts: T0, syncedAt: "不是时间" }) === true);
check(
  "时间戳全坏 → 要推（不能因为算不出来就当成推过了）",
  needsPush({ key: "d", ts: "??", syncedAt: "??" }) === true
);
check("空对象不炸", needsPush(null) === false && pendingJobs(null).length === 0);

/* ⚠️ 这一条钉的是**用 Date.parse 而不是字符串比较**。

   现有数据的 ts 是 ISO（2026-09-05T00:00:00.000Z），而 demo 数据用的是
   "2026-09-05 12:00:00" 这种带空格的格式。两种混在一起时字面比较会翻车：
   同一天、真实时间更晚的那个，字面上反而更小 —— 因为空格(0x20)
   排在 T(0x54) 前面。于是"12 点改过、0 点推过"会被判成"不用推"。

   我第一版的例子（9/9 对 9/5）分不出两种做法 —— 字面比较在那个例子上
   碰巧也给对了答案。一条两种实现都能过的断言，等于没有断言。 */
{
  const sameDay = {
    key: "e",
    updatedAt: "2026-09-05 12:00:00", // 真实时间更晚
    syncedAt: "2026-09-05T00:00:00.000Z",
  };
  const literalSays = sameDay.updatedAt > sameDay.syncedAt;
  check(
    "同一天、空格格式 vs ISO：Date.parse 判对，字面比较判错",
    needsPush(sameDay) === true && literalSays === false,
    "字面比较会说「不用推」（" + String(literalSays) + "）"
  );
}
/* ─────────────────────────────────────────── 3. touch 的语义 */
group("3. touch / lastChangedAt");

check("touch 写 updatedAt，不动 ts", (() => {
  const r = touch({ key: "f", ts: T0 }, T2);
  return r.updatedAt === T2 && r.ts === T0;
})());
check("touch 不改别的字段", (() => {
  const r = touch({ key: "f", ts: T0, status: "已投", failReason: "讲不明白" }, T2);
  return r.status === "已投" && r.failReason === "讲不明白";
})());
check("updatedAt 优先于 ts", lastChangedAt({ ts: T0, updatedAt: T2 }) === T2);
check("没有 updatedAt 时退回 ts", lastChangedAt({ ts: T0 }) === T0);
check("两个都没有 → 空串", lastChangedAt({}) === "" && lastChangedAt(null) === "");
check("markSynced 写 syncedAt，不动 updatedAt", (() => {
  const r = markSynced({ key: "g", updatedAt: T2 }, T1);
  return r.syncedAt === T1 && r.updatedAt === T2;
})());

/* ─────────────────────────────────────────── 4. 增量推 */
group("4. 增量：第二次同步不该再推一遍");

{
  const now = "2026-09-10T00:00:00.000Z";
  const jobs = [
    { key: "1", ts: T0 },
    { key: "2", ts: T0 },
    { key: "3", ts: T0 },
  ];
  check("第一次：全都要推（谁都没有水位线）", pendingJobs(jobs).length === 3);

  const after = jobs.map((j) => markSynced(j, now));
  check("推完之后：0 条待推", pendingJobs(after).length === 0);

  const one = after.map((j) => (j.key === "2" ? touch(j, "2026-09-11T00:00:00.000Z") : j));
  check("只改了一条 → 只推那一条", pendingJobs(one).length === 1 && pendingJobs(one)[0].key === "2");
}

/* 中断可续：推了一半就断，重跑只推剩下的 */
{
  const now = "2026-09-10T00:00:00.000Z";
  const jobs = [{ key: "1", ts: T0 }, { key: "2", ts: T0 }, { key: "3", ts: T0 }];
  const halfway = jobs.map((j) => (j.key === "1" ? markSynced(j, now) : j));
  const left = pendingJobs(halfway);
  check(
    "推到一半断掉，重跑只剩没推的那些",
    left.length === 2 && left.every((j) => j.key !== "1"),
    left.map((j) => j.key).join(",")
  );
}

console.log("");
console.log(fail ? "✗ " + fail + " 条不过" : "✓ 全过");
process.exit(fail ? 1 : 0);
