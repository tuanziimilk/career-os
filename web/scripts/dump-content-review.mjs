/* 把两份内容产物摊开成人能读的 Markdown，供签章前人工过一遍。
 *
 *     node web/scripts/dump-content-review.mjs
 *     → docs/内容review-待确认_<今天>.md
 *
 * ⚠️ **产物已加进 .gitignore，别提交它。**
 *   它是某个时点的内容快照，而那个时点的内容**可能还没脱敏**。
 *   2026-09-15 就是这么把一份脱敏前的快照推进公开仓库的 —— 产物清干净了，
 *   快照里还留着旧内容。要看就现跑，别留档。
 *
 * ══════════ 为什么要有这个脚本 ══════════
 *
 * 签章那道闸门（`review-content.mjs`）挡的是「没人读过就进公开仓库」。
 * 但 `modules.json` / `questions.json` 是 JSON，**不是给人读的格式** ——
 * 要求人去读一个 89 张卡的 JSON，等于要求他不读然后签。
 *
 * 2026-09-15 第一版是一次性手工产出的（1297 行），然后内容一改它就过期了，
 * 而过期的 review 材料比没有更糟：**它让人以为自己看的是当前版本。**
 * 所以落成脚本，每次改完内容重跑一次。
 * （同样的道理写在 FEATURES.md §5：清册不要手写维护。）
 *
 * ⚠️ 这个脚本**不做判断**，只做排版。它上面那份「重点候选」表是人挑的，
 * 机器能挑的部分已经在 `scanLeaks()` 里了 —— 而那一层只认已知的词，
 * 「内容质检平台」这种**两个大写字母 + 中文产品名**的内部系统命名，
 * 词表天生抓不到，只能靠人读。这就是这份材料存在的全部理由。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanLeaks, modulesToItems, questionsToItems } from "./leaks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "src", "data");
const DOCS = join(HERE, "..", "..", "docs");

const modules = JSON.parse(readFileSync(join(DATA, "modules.json"), "utf8"));
const questions = JSON.parse(readFileSync(join(DATA, "questions.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);

/* 仍然带第二人称、且指向真实经历的句子。
   ⚠️ 刻意**不**把所有「你」都列出来：教学口吻的第二人称（「你的网站」
   「你的程序真正执行这个函数」）是正常写法，全列出来会把真正要看的淹掉。
   判据是「你 + 完成时/所有格 + 具体事物」。 */
const PERSONAL = /你(早就[在会]|现有|现成|的经历|的实战|在数据|的项目|的工具|的字段|的差异化)[^，。；！？\n]{0,40}/g;

const cards = modules.flatMap((m) => m.cards.map((c) => ({ ...c, module: m.id })));
const personalHits = [];
for (const c of cards) {
  let x;
  const re = new RegExp(PERSONAL.source, "g");
  while ((x = re.exec(c.excerpt)) !== null) personalHits.push({ id: c.id, text: x[0] });
}

const leaks = scanLeaks([
  { name: "modules.json", items: modulesToItems(modules) },
  { name: "questions.json", items: questionsToItems(questions) },
]);

const L = [];
L.push("# 内容人工 review · 待确认");
L.push("");
L.push(`> 生成时间：${today} · 由 \`web/scripts/dump-content-review.mjs\` 生成，**不要手改**。`);
L.push("> 内容改过之后重跑一次，否则你读的是旧版本。");
L.push(">");
L.push(
  `> 对象：\`web/src/data/modules.json\`（${modules.length} 模块 / ${cards.length} 张卡）` +
    `与 \`web/src/data/questions.json\`（${questions.length} 题）`
);
L.push("");
L.push("> 闸门要求确认四类东西不存在：①公司名 ②内部系统名 ③在投公司名 ④个人短板自评原文");
L.push("> 看完回到 `web/` 跑 `npm run content:review` 签章。");
L.push("");
L.push("---");
L.push("");
L.push("## 机器能查的部分");
L.push("");
if (leaks.length === 0) {
  L.push("`scanLeaks()` 词表扫描 **全绿**（词表在 `web/scripts/leaks.mjs`）。");
  L.push("");
  L.push("⚠️ 但它只认**已经知道的词**。真正需要你判断的是词表抓不到的那类 ——");
  L.push("比如「两个大写字母代号 + 中文产品名」这种内部系统命名。");
} else {
  L.push(`⚠️ 扫到 ${leaks.length} 处，**先处理掉再谈 review**：`);
  L.push("");
  for (const h of leaks) L.push(`- \`${h.id}\` 命中「${h.word}」—— ${h.why}`);
}
L.push("");
L.push("## 仍然带第二人称、指向真实经历的句子");
L.push("");
if (personalHits.length === 0) {
  L.push("没有。");
} else {
  L.push(`共 ${personalHits.length} 处。判断它们要不要留 —— 仓库公开的话，`);
  L.push("它们会把工作内容一句一句讲出来；只给面试官看的话，保留反而是加分项。");
  L.push("");
  for (const h of personalHits) L.push(`- **\`${h.id}\`** …${h.text}…`);
}
L.push("");
L.push("⚠️ 教学口吻的第二人称（「你的网站」「你的程序」）没有列进来 ——");
L.push("那是正常写法，全列出来会把真正要看的淹掉。");
L.push("");
L.push("---");
L.push("");
L.push("## 全文");
for (const m of modules) {
  L.push("");
  L.push(`### 模块 ${m.id} · ${m.title}`);
  for (const c of m.cards) {
    L.push("");
    L.push(`#### [${c.id}] ${c.title}`);
    L.push("");
    L.push(c.excerpt);
    for (const d of c.diagrams || []) {
      L.push("");
      L.push("```mermaid");
      L.push(d);
      L.push("```");
    }
  }
}
L.push("");
L.push("## 面试题");
L.push("");
for (const q of questions) {
  L.push(`- **[${q.id}] ${q.question}** ${q.answer}`);
}
L.push("");

const out = join(DOCS, `内容review-待确认_${today}.md`);
writeFileSync(out, L.join("\n"), "utf8");
console.log(`已生成 ${out}`);
console.log(
  `  ${modules.length} 模块 / ${cards.length} 卡 / ${questions.length} 题 · ` +
    `词表命中 ${leaks.length} · 第二人称待判断 ${personalHits.length}`
);
