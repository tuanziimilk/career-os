/* 「本版已 review」标记。
 *
 *     node career-web/scripts/review-content.mjs          # 查（build 会跑这个）
 *     node career-web/scripts/review-content.mjs --sign    # 签（看过了，记下来）
 *
 * ══════════ 这份文件解决的问题 ══════════
 *
 * import-content.mjs 的文件头从第一版就写着：
 *
 *     「之后必须人工 review 输出的 modules.json / questions.json，
 *       确认没有公司名/内部系统名/个人短板自评原文 —— 这是硬性红线，
 *       脚本只做脱敏词替换，不能替代人工过一遍的判断。」
 *
 * 而这条"硬性红线"的全部执行机制，是脚本跑完在终端打三行提示。
 * **没有任何东西记录过它到底有没有被执行过。** 我自己这几轮跑了好几次导入，
 * 一次都没有逐条看过产物 —— 也就是说这条红线从写下来到现在一直是空的。
 *
 * 所以这里给它一个最小的机械形式：
 *   · 记下「哪一版内容被谁在哪天看过」（按条目逐条记哈希）
 *   · 内容变了就让 build 失败，并**指名道姓列出是哪几条变了**
 *
 * ⚠️ 关键设计：失败信息必须精确到条目。
 * 一个只会说"内容变了，请重新 review"的闸门，会被用一次 `--sign` 敷衍过去 ——
 * 那时它就只是一道手续，不是防线。而「新增 5 条、改了 2 条，就是这 7 条」
 * 是**真的能看完**的工作量，看完签才有意义。
 *
 * ⚠️ 这个标记**不证明内容是干净的**，只证明有人看过。
 * 机器能查的那部分在 leaks.mjs（词表扫描），而它必然覆盖不全 ——
 * 两者是互补的，都不能替代对方。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanLeaks, modulesToItems, questionsToItems, printLeaks } from "./leaks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "src", "data");
const MARK = join(DATA, "content-review.json");

function hash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/** 产物 → { 条目 id: 内容哈希 }。哈希算的是**内容**，不含条目 id 本身，
    所以卡片换了位置（id 是位置型的 m1-c3）会显示成"改了"——那是对的，
    位置型 id 下换位置确实等于换了内容归属。 */
export function digestProducts() {
  const modules = JSON.parse(readFileSync(join(DATA, "modules.json"), "utf8"));
  const questions = JSON.parse(readFileSync(join(DATA, "questions.json"), "utf8"));
  const out = { "modules.json": {}, "questions.json": {} };
  for (const it of modulesToItems(modules)) out["modules.json"][it.id] = hash(it.text);
  for (const it of questionsToItems(questions)) out["questions.json"][it.id] = hash(it.text);
  return { digests: out, modules, questions };
}

/** 和已签版本比。返回每份产物的 added / changed / removed。 */
export function diffAgainstMark(digests) {
  const mark = existsSync(MARK) ? JSON.parse(readFileSync(MARK, "utf8")) : null;
  const prev = (mark && mark.items) || {};
  const result = {};
  for (const name of Object.keys(digests)) {
    const now = digests[name];
    const old = prev[name] || {};
    result[name] = {
      added: Object.keys(now).filter((k) => !(k in old)),
      changed: Object.keys(now).filter((k) => k in old && old[k] !== now[k]),
      removed: Object.keys(old).filter((k) => !(k in now)),
    };
  }
  return { mark, result };
}

function totalPending(result) {
  return Object.values(result).reduce(
    (n, r) => n + r.added.length + r.changed.length + r.removed.length,
    0
  );
}

function printPending(result, limit = 40) {
  for (const [name, r] of Object.entries(result)) {
    if (!r.added.length && !r.changed.length && !r.removed.length) continue;
    console.log(`\n  ── ${name} ──`);
    for (const [label, list] of [
      ["新增", r.added],
      ["内容变了", r.changed],
      ["不见了", r.removed],
    ]) {
      if (!list.length) continue;
      console.log(`  ${label} ${list.length} 条：`);
      for (const id of list.slice(0, limit)) console.log(`     · ${id}`);
      if (list.length > limit) console.log(`     …还有 ${list.length - limit} 条`);
    }
  }
}

const SIGN = process.argv.includes("--sign");
const { digests, modules, questions } = digestProducts();

/* 签之前先跑一遍词表扫描。理由：`--sign` 是唯一一个"我看过了"的动作，
   在它上面挂一次机器检查几乎不要钱，而漏签一次的代价是不可逆的。 */
const hits = scanLeaks([
  { name: "modules.json", items: modulesToItems(modules) },
  { name: "questions.json", items: questionsToItems(questions) },
]);
if (hits.length) {
  console.error(`\n✗ 产物里扫到 ${hits.length} 处可能的隐私泄漏（词表在 scripts/leaks.mjs）：`);
  printLeaks(hits);
  console.error("\n  先把这些处理掉再谈 review。");
  process.exit(1);
}

const { mark, result } = diffAgainstMark(digests);
const pending = totalPending(result);

if (SIGN) {
  const counts = {
    modules: modules.length,
    cards: modules.reduce((n, m) => n + m.cards.length, 0),
    diagrams: modules.reduce(
      (n, m) => n + m.cards.reduce((k, c) => k + (c.diagrams || []).length, 0),
      0
    ),
    questions: questions.length,
  };
  writeFileSync(
    MARK,
    JSON.stringify(
      {
        note:
          "人工 review 签章。记的是「哪一版内容被看过」，不是「内容是干净的」。" +
          "内容变了 npm run build 会失败并列出变了哪几条；看完那几条再跑 npm run content:review。",
        reviewedAt: new Date().toISOString().slice(0, 10),
        counts,
        items: digests,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log(`✅ 已签章：${new Date().toISOString().slice(0, 10)}`);
  console.log(
    `   ${counts.modules} 个模块 / ${counts.cards} 张卡 / ${counts.diagrams} 张图 / ${counts.questions} 道题`
  );
  if (pending) console.log(`   （这次签掉了 ${pending} 条待复核）`);
  process.exit(0);
}

// ---- 查模式 ----
if (!mark) {
  console.log("── 内容人工 review 状态 ──");
  console.log("  还没有任何签章记录。");
  console.log("  这不是「忘了签」—— 在这之前项目里根本没有这个机制，");
  console.log("  导入脚本只是在终端打一行「必须人工 review」，没人记录过它有没有被执行。");
  console.log("\n  第一次要看的就是全部内容：");
  console.log("     src/data/modules.json  ·  src/data/questions.json");
  console.log("  确认没有公司名/内部系统名/在投公司名/个人短板自评原文，然后：");
  console.log("     npm run content:review");
  process.exit(1);
}

console.log("── 内容人工 review 状态 ──");
console.log(`  上次签章：${mark.reviewedAt}`);
if (mark.counts) {
  console.log(
    `  当时的量：${mark.counts.modules} 模块 / ${mark.counts.cards} 卡 / ${mark.counts.questions} 题`
  );
}

if (pending === 0) {
  console.log("  产物和签章那一版逐条一致。");
  process.exit(0);
}

console.log(`\n✗ 有 ${pending} 条内容在上次签章之后变了，需要你看一眼。`);
printPending(result);
console.log("\n  看的时候只看上面列出的这几条就够了 —— 其余部分和你签过的那版逐字相同。");
console.log("  在 src/data/modules.json / questions.json 里搜对应的 id。");
console.log("  确认里面没有自评、短板、公司名、在投公司名之后：");
console.log("     npm run content:review");
process.exit(1);
