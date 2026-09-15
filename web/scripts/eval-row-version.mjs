/* 多端并发写冲突检测的断言。
 *
 *     node career-web/scripts/eval-row-version.mjs
 *
 * ══════════ 为什么要用假数据库 ══════════
 *
 * 这套机制要防的情形是「我读到这一行之后，**另一端**改了它」。
 * 在真实云端制造这个情形要开两个会话、掐时序，手动做一次能做，
 * 每次改代码都做一遍不可能 —— 结果就是它会以"写完了但从没验证过"的状态存在。
 *
 * 所以 rowVersion.ts 把数据库访问收窄成两个方法，这里传一个假的进去。
 * 假实现只做一件事：记住每行的 updated_at，并且**严格按版本号匹配** ——
 * 这正是 Postgres 那条 `where updated_at = ?` 的行为。
 *
 * ⚠️ 这里测不到的东西，如实列出来：
 *   · `.eq("updated_at", …)` 的时间戳文本格式在 PostgREST 那边**是否精确匹配**
 *     （timestamptz 读回来是 "2026-09-11T03:04:05.123456+00:00" 这种，
 *      带微秒和时区；把它原样发回去做等值比较，理论上成立，但我没在真库上验过）
 *   · 表上的 BEFORE UPDATE 触发器在不在。代码不依赖它（显式写 updated_at），
 *     但"不依赖"这件事本身也只在假库上验过
 * 这两条要靠你在真库上点一次两端并发操作才算数。
 */
import { RowVersions, writeVersioned, CONFLICT_MSG } from "../src/lib/rowVersion.ts";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

/** 假数据库。行的键是 表::id，值是 { updated_at, ...字段 }。 */
function makeDb(initial = {}) {
  const rows = new Map(Object.entries(initial));
  let seq = 0;
  const db = {
    calls: { update: 0, upsert: 0 },
    async updateIfVersion({ table, id, expectedUpdatedAt, patch }) {
      db.calls.update++;
      const k = table + "::" + id;
      const row = rows.get(k);
      // 这就是 `where ... and updated_at = ?`：不匹配就是影响 0 行
      if (!row || row.updated_at !== expectedUpdatedAt) return { rows: [] };
      const next = { ...row, ...patch, updated_at: "v" + ++seq };
      rows.set(k, next);
      return { rows: [{ updated_at: next.updated_at }] };
    },
    async upsertRow({ table, id, patch }) {
      db.calls.upsert++;
      const k = table + "::" + id;
      const next = { ...(rows.get(k) || {}), ...patch, updated_at: "v" + ++seq };
      rows.set(k, next);
      return { rows: [{ updated_at: next.updated_at }] };
    },
    /** 模拟"另一端改了这一行" */
    otherDeviceWrites(table, id, patch) {
      const k = table + "::" + id;
      rows.set(k, { ...(rows.get(k) || {}), ...patch, updated_at: "v" + ++seq });
    },
    read(table, id) {
      return rows.get(table + "::" + id);
    },
  };
  return db;
}

const T = "career_learning_progress";
const write = (db, versions, patch) =>
  writeVersioned({ db, versions, table: T, idCol: "module_id", id: "M3", uid: "u1", patch });

console.log("── 没读过这一行：退回 upsert，不假装能检测 ──");
{
  const db = makeDb();
  const v = new RowVersions();
  const r = await write(db, v, { status: "在读" });
  check("写成功", r.ok === true);
  check("走的是 upsert 而不是条件更新", db.calls.upsert === 1 && db.calls.update === 0);
  check("写完之后记住了版本号（下一次就能检测了）", v.get(T, "M3") === "v1", v.get(T, "M3"));
}

console.log("\n── 读过、且没人动过：条件更新成功 ──");
{
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  const v = new RowVersions();
  v.remember(T, "M3", "v0"); // 模拟"读的时候记下了"
  const r = await write(db, v, { status: "在读" });
  check("写成功", r.ok === true);
  check("走的是条件更新", db.calls.update === 1 && db.calls.upsert === 0);
  check("值真的写进去了", db.read(T, "M3").status === "在读");
  check("版本号刷新成了新的", v.get(T, "M3") === "v1", v.get(T, "M3"));
}

console.log("\n── 核心断言：另一端改过之后，我的写必须被拦住 ──");
/* ⚠️ 这就是那个真实会丢数据的场景：
   手机标了「能空手讲」，电脑那个开了半小时的标签页再点一下 M3 ——
   旧实现（无条件 upsert）会把手机那次标记覆盖掉，而且不报错。 */
{
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  const v = new RowVersions();
  v.remember(T, "M3", "v0");

  db.otherDeviceWrites(T, "M3", { status: "能空手讲" }); // 手机上标了

  const r = await write(db, v, { status: "在读" }); // 电脑上这次点击
  check("写被拒绝", r.ok === false);
  check("并且标成 conflict（和普通失败要能分开）", r.conflict === true);
  check("理由是人话，说清了该干什么", r.reason === CONFLICT_MSG);
  check(
    "⭐ 另一端的值没有被覆盖掉（旧实现这里会变成「在读」）",
    db.read(T, "M3").status === "能空手讲",
    db.read(T, "M3").status
  );
  check(
    "冲突后丢掉本地版本号（留着它下次还撞，而界面此时该重新读）",
    v.get(T, "M3") === undefined
  );
}

console.log("\n── 冲突之后：重新读 → 再写，要能成功 ──");
/* 界面上的处理就是这个流程（页面收到 conflict 后 await load()）。
   如果这一条不通，那这套机制就是"一旦冲突就永远写不进去"。 */
{
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  const v = new RowVersions();
  v.remember(T, "M3", "v0");
  db.otherDeviceWrites(T, "M3", { status: "能空手讲" });
  await write(db, v, { status: "在读" }); // 撞一次

  // 界面重新读，记下云端现在的版本
  v.remember(T, "M3", db.read(T, "M3").updated_at);
  const r2 = await write(db, v, { status: "在读" });
  check("重新读之后再写就成功了", r2.ok === true);
  check("值是这一次写的", db.read(T, "M3").status === "在读");
}

console.log("\n── 那一行被删了，也算冲突（处理方式一样：先看看云端）──");
{
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  const v = new RowVersions();
  v.remember(T, "M3", "v0");
  const r = await write(db, v, { status: "在读" });
  check("正常写成功打底", r.ok === true);

  const db2 = makeDb(); // 那一行根本不在了
  const v2 = new RowVersions();
  v2.remember(T, "M3", "v0");
  const r2 = await write(db2, v2, { status: "在读" });
  check("行不存在 + 有版本号 → conflict", r2.ok === false && r2.conflict === true);
}

console.log("\n── 连续点两次不该误报冲突 ──");
/* 这条是防"检测太严"的。用户连点两次状态是完全正常的操作，
   如果第二次报冲突，这个机制就没法用了。 */
{
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  const v = new RowVersions();
  v.remember(T, "M3", "v0");
  const a = await write(db, v, { status: "在读" });
  const b = await write(db, v, { status: "已懂" });
  const c = await write(db, v, { status: "能空手讲" });
  check("三次连点全部成功", a.ok && b.ok && c.ok);
  check("最后的值对", db.read(T, "M3").status === "能空手讲");
}

console.log("\n── updated_at 不依赖触发器：每次写都显式带上 ──");
{
  const seen = [];
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  const orig = db.updateIfVersion;
  db.updateIfVersion = async (args) => {
    seen.push(args.patch);
    return orig(args);
  };
  const v = new RowVersions();
  v.remember(T, "M3", "v0");
  await writeVersioned({
    db,
    versions: v,
    table: T,
    idCol: "module_id",
    id: "M3",
    uid: "u1",
    patch: { status: "在读" },
    now: () => "2026-09-11T00:00:00.000Z",
  });
  check("patch 里带了 updated_at", !!seen[0] && !!seen[0].updated_at, JSON.stringify(seen[0]));
  check("用的是注入的时间（可重复）", seen[0].updated_at === "2026-09-11T00:00:00.000Z");
  check("原有字段没被挤掉", seen[0].status === "在读");
}

console.log("\n── 数据库报错不能被当成冲突 ──");
/* 两者的处理方式相反：报错该重试，冲突该先看云端。混在一起会让人做错动作。 */
{
  const db = makeDb({ [T + "::M3"]: { status: "未读", updated_at: "v0" } });
  db.updateIfVersion = async () => ({ rows: [], error: "42501 permission denied" });
  const v = new RowVersions();
  v.remember(T, "M3", "v0");
  const r = await write(db, v, { status: "在读" });
  check("失败", r.ok === false);
  check("不是 conflict", r.conflict !== true);
  check("原因是数据库那句话", r.reason === "42501 permission denied");
  check("版本号**不**丢（这不是版本问题，丢了反而失去检测能力）",
    v.get(T, "M3") === "v0", String(v.get(T, "M3")));
}

console.log("\n── 不同表、不同行互不干扰 ──");
{
  const db = makeDb();
  const v = new RowVersions();
  await writeVersioned({ db, versions: v, table: "a", idCol: "i", id: "1", uid: "u", patch: {} });
  await writeVersioned({ db, versions: v, table: "b", idCol: "i", id: "1", uid: "u", patch: {} });
  await writeVersioned({ db, versions: v, table: "a", idCol: "i", id: "2", uid: "u", patch: {} });
  check("三个独立的版本号", v.size === 3, String(v.size));
  check("同名 id 不同表不串", v.get("a", "1") !== v.get("b", "1"));
}

console.log("");
if (fail) {
  console.log(`!! ${fail} 条断言不过`);
  process.exit(1);
}
console.log("全部断言通过");
