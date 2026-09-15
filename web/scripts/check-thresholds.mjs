/* 阈值登记表 ↔ 源码 的一致性校验。
 *
 *     node career-web/scripts/check-thresholds.mjs
 *
 * ══════════ 为什么是「登记 + 校验」而不是「搬到一处」 ══════════
 *
 * 直觉做法是把所有阈值搬进一个共享常量文件，两个代码库都 import。
 * 但这个项目里已经有三份共享物了（salary.js / skills.json / 以及
 * gap.js ↔ match.ts 那段手工移植的命中判定），第三份**项目自己承认没人看住**。
 * 再加一份就是第四个漂点，而且那是一次要动六七个正在工作的文件的重构。
 *
 * 所以反过来：常量留在原地，另建一张登记表说明「值是多少 / 依据是什么 /
 * 被测量过没有」，再让这个脚本去源文件里**逐字找那一行**。
 *
 *   · 改了代码没改登记表 → 找不到那一行 → build 失败
 *   · 改了登记表没改代码 → 同样找不到 → build 失败
 *
 * 换句话说：登记表不是文档，是**契约**。这比"共享常量"风险小，
 * 而且它顺带解决了真正的问题——那些数字现在能被看见（07 校准台会显示这张表）。
 *
 * ⚠️ 刻意用「整行逐字匹配」而不是解析出数值再比对：
 * 写个小解析器意味着我要处理 JS 和 TS 两种语法、对象字面量、默认参数……
 * 而它的失败方式是**在你以为校验了的时候其实没校验**。
 * 逐字匹配很笨，但它错的时候是"报错"，不是"静默放过"。
 * （这个教训来自同一天：我给 eval-capability-note 写了个正则剥类型的
 *   小解析器，它把返回值对象字面量也剥了。）
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
/* 登记表里的 file 是**相对仓库根目录**写的（extension/ 是扩展、web/ 是工作台、
   analyzer/ 是 Python 侧），这样一眼能看出某个阈值属于哪一端。
   2026-09-15 单仓库合并后这句话才名副其实——之前它指的是两个兄弟目录，
   而那个「仓库组根目录」在 git 里并不存在。 */
const ROOT = resolve(HERE, "..", "..");
const REG = join(HERE, "..", "src", "data", "thresholds.json");

const reg = JSON.parse(readFileSync(REG, "utf8"));
const rows = reg.thresholds || [];

let fail = 0;
const cache = new Map();

function readSrc(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const p = join(ROOT, rel);
  const txt = existsSync(p) ? readFileSync(p, "utf8") : null;
  cache.set(rel, txt);
  return txt;
}

console.log("── 阈值登记 ↔ 源码 ──");

const seen = new Set();
for (const t of rows) {
  const bad = [];
  for (const k of ["id", "name", "value", "file", "assert", "measured", "rationale"]) {
    if (!t[k]) bad.push(`缺 ${k}`);
  }
  if (seen.has(t.id)) bad.push("id 重复");
  seen.add(t.id);
  if (!["yes", "partial", "no"].includes(t.measured)) {
    bad.push(`measured 只能是 yes/partial/no，现在是 ${JSON.stringify(t.measured)}`);
  }

  if (bad.length === 0) {
    const src = readSrc(t.file);
    if (src == null) {
      bad.push(`源文件不存在：${t.file}`);
    } else if (!src.includes(t.assert)) {
      bad.push(
        `源码里找不到这一行 —— 代码和登记表已经不一致。\n` +
        `           登记表说：${t.assert}\n` +
        `           改了值就同步改这张表（连 rationale 一起），别只改一边。`
      );
    }
  }

  console.log((bad.length ? "  FAIL " : "  ok   ") + t.id.padEnd(22) + t.value);
  if (bad.length) {
    fail++;
    bad.forEach((b) => console.log("         " + b));
  }
}

/* 反向：源码里有、登记表里没有的阈值查不出来（那需要真的解析源码）。
   所以这里只能做一件事——把这个局限如实说出来，而不是假装覆盖全。 */
console.log("");
console.log("已登记 %d 项。", rows.length);
console.log(
  "⚠️ 这个脚本只能保证「登记表里的每一项都和源码一致」，"
);
console.log(
  "   保证不了「源码里所有阈值都被登记了」—— 那需要真解析源码。"
);
console.log("   新加一个影响结论的常量时，请手动补进 src/data/thresholds.json。");

const counts = { yes: 0, partial: 0, no: 0 };
rows.forEach((t) => (counts[t.measured] = (counts[t.measured] || 0) + 1));
console.log(
  "有正当依据 %d 项 · 方向有理由但数字是拍的 %d 项 · 完全没依据 %d 项",
  counts.yes, counts.partial, counts.no
);

if (fail) {
  console.log("\n!! %d 项不一致", fail);
  process.exit(1);
}
console.log("\n全部一致");
