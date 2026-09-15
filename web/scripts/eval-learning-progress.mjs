/* 学习进度指标的断言。
 *
 *     node web/scripts/eval-learning-progress.mjs
 *
 * ══════════ 钉的是什么 ══════════
 *
 * 同一个指标原来在首页和学习页各算一遍，分母不一样：
 *   学习页 1/9（分母 = 内容里的模块数）
 *   首页   1/2（分母 = **数据库里有进度记录的行数**）
 *
 * 首页那个错法有个很反常的症状：**越用越退步**。
 * 你去标记第三个模块，分母从 2 变成 3，进度条往回走 ——
 * 而这是使用这个功能唯一的正常动作。
 *
 * 下面的第一组断言就是在钉这一条：加一行"在读"的进度记录，
 * 分母必须纹丝不动。对着旧的首页实现，它是红的。
 */
import { learningProgress, DONE_STATUS } from "../src/lib/learningProgress.ts";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const IDS = ["M1", "M2", "M3", "M4", "M5"];

console.log("── 分母永远是内容里的模块数 ──");
check("没有任何进度记录时，分母仍是 5", learningProgress(IDS, []).total === 5,
  `total=${learningProgress(IDS, []).total}`);
check("没有进度记录时 done=0", learningProgress(IDS, []).done === 0);

const one = learningProgress(IDS, [{ id: "M1", status: DONE_STATUS }]);
check("标完一个：1/5", one.done === 1 && one.total === 5, `${one.done}/${one.total}`);

/* ⚠️ 这一条是核心。旧实现下分母 = 进度行数，
   所以多标一个"在读"会让分母从 1 变成 2，显示 1/2 而不是 1/5。 */
const plusReading = learningProgress(IDS, [
  { id: "M1", status: DONE_STATUS },
  { id: "M2", status: "在读" },
]);
check(
  "再标一个「在读」，分母不许变（旧实现这里会变成 1/2）",
  plusReading.done === 1 && plusReading.total === 5,
  `${plusReading.done}/${plusReading.total}`
);
check(
  "进度条不许倒退",
  plusReading.ratio === one.ratio,
  `${one.ratio.toFixed(3)} → ${plusReading.ratio.toFixed(3)}`
);

console.log("\n── 只有「能空手讲」算学完 ──");
for (const s of ["未读", "在读", "已懂"]) {
  check(`「${s}」不算`, learningProgress(IDS, [{ id: "M1", status: s }]).done === 0);
}
check(`「${DONE_STATUS}」算`, learningProgress(IDS, [{ id: "M1", status: DONE_STATUS }]).done === 1);

console.log("\n── 孤儿进度行：指向已不存在的模块 ──");
/* 第二个、更隐蔽的差异：旧的首页直接数进度行，
   所以一行指向已经从 modules.json 里删掉的模块也会被算进分子，
   能算出 11/10 这种数。 */
const orphan = learningProgress(IDS, [
  { id: "M1", status: DONE_STATUS },
  { id: "M99", status: DONE_STATUS }, // modules.json 里没有 M99
]);
check("孤儿行不算进分子（旧实现会算成 2/5）", orphan.done === 1, `done=${orphan.done}`);
check("孤儿行不算进分母", orphan.total === 5, `total=${orphan.total}`);
check("但要报出来有几行孤儿（内容和状态脱节了，得有人知道）", orphan.orphanRows === 1,
  `orphanRows=${orphan.orphanRows}`);

console.log("\n── 边界 ──");
const empty = learningProgress([], []);
check("一个模块都没有时 ratio 是 0 而不是 NaN", empty.ratio === 0, String(empty.ratio));
/* NaN 会被塞进 `width: ${ratio*100}%`，CSS 里就是整条进度条不渲染 —— 不报错的那种坏。 */
check("ratio 不是 NaN（它会进 CSS 宽度）", !Number.isNaN(empty.ratio));
const all = learningProgress(IDS, IDS.map((id) => ({ id, status: DONE_STATUS })));
check("全部学完 ratio=1", all.ratio === 1 && all.done === 5);
check("重复的进度行不会算两次", learningProgress(["M1"], [
  { id: "M1", status: DONE_STATUS },
  { id: "M1", status: DONE_STATUS },
]).done === 1);

console.log("\n── 真实内容对账 ──");
const modules = JSON.parse(
  (await import("node:fs")).readFileSync(
    new URL("../src/data/modules.json", import.meta.url),
    "utf8"
  )
);
const real = learningProgress(modules.map((m) => m.id), []);
check(
  `分母等于 modules.json 里的模块数（现在 ${modules.length}）`,
  real.total === modules.length,
  `${real.total}`
);

console.log("");
if (fail) {
  console.log(`!! ${fail} 条断言不过`);
  process.exit(1);
}
console.log("全部断言通过");
