/* M9 脑图图源的产出闸门。
 *
 *     node career-web/scripts/check-diagrams.mjs
 *
 * ══════════ 和 import-content.mjs 里的 guardDiagrams 有什么不一样 ══════════
 *
 * guardDiagrams 拦的是「这次导入解析炸了」—— 它只在**跑导入的时候**说话。
 * 而 modules.json 是提交进仓库的产物：它可能被手改、被 merge 改坏、
 * 或者在别人的机器上由一个改坏了的脚本重新生成后提交。
 * 这个脚本查的是**仓库里现在那份产物本身**，每次 build 都跑。
 *
 * 两道闸门盯的是同一件事的两个时刻。少了任何一个都有一段路没人看。
 *
 * ⚠️ 断言刻意都是「结构性」的，不写死 6 这个数字：
 * 往 M9 加第七张图、或把一张拆成两张，都是正常编辑动作，不该红。
 * 张数变化靠输出里打印出来让人看见，不靠拦。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractDiagrams } from "./import-content.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = join(HERE, "..", "src", "data", "modules.json");
const M9_SOURCE = join(
  HERE,
  "..",
  "..",
  "career-knowledgebase",
  "03-学习笔记",
  "M9-Agent系统脑图.md"
);

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const modules = JSON.parse(readFileSync(MODULES, "utf8"));
const all = modules.flatMap((m) =>
  m.cards.map((c) => ({ module: m.id, card: c.id, title: c.title, card_obj: c }))
);
const withDia = all.filter((c) => Array.isArray(c.card_obj.diagrams) && c.card_obj.diagrams.length);
const diagrams = withDia.flatMap((c) =>
  c.card_obj.diagrams.map((src) => ({ ...c, src }))
);

console.log("── 图源有没有进来 ──");
console.log(
  `  ${modules.length} 个模块 / ${all.length} 张卡 / ${withDia.length} 张卡带图 / 共 ${diagrams.length} 张图`
);
for (const d of withDia) {
  console.log(
    `    ${d.card}  ${d.title.slice(0, 24)}  ${d.card_obj.diagrams.length} 张`
  );
}

const m9 = modules.find((m) => m.id === "M9");
check("M9 在产物里", !!m9);
check(
  "M9 至少有一张图（它是脑图页唯一的内容源）",
  !!m9 && m9.cards.some((c) => c.diagrams && c.diagrams.length),
  m9 ? `${m9.cards.filter((c) => c.diagrams).length} 张卡带图` : ""
);

console.log("\n── 和知识库原文逐字比对（唯一真正可靠的完整性判据）──");
/* ⚠️ 这一节是补出来的，而它补的是我自己的一次失败。
 *
 * 我最先只写了下面那组「结构性」断言（首行是图类型、末行不是断掉的连线、
 * 引号成对），然后按规矩拿一张图截断到 300 字去验证闸门会不会红 ——
 * **它没红。** 因为 300 字这一刀正好落在换行后的缩进空格上：
 * 末行是两个空格，不以箭头结尾、引号数为 0、括号也平。全部断言都绿。
 *
 * 结论不是"再多加几条启发式"。截断可以落在任何位置，而启发式只覆盖
 * 它落在某些位置的情形 —— 那种闸门的通过率取决于运气，不取决于正确性。
 * 唯一靠得住的判据是**和源头逐字比**。
 *
 * ⚠️ 知识库不在版本控制里（别人克隆仓库时没有 career-knowledgebase 目录）。
 * 所以这一节在源文件缺失时**跳过**，并明确说自己跳过了 ——
 * 而不是在没有源头的机器上假装比对通过了。
 */
if (!existsSync(M9_SOURCE)) {
  console.log("  跳过：找不到 M9 源文件（知识库不在版本控制里）。");
  console.log("        在没有知识库的机器上，下面的结构性断言是唯一的防线，");
  console.log("        而它们只能抓住一部分截断 —— 这个局限是真的，别当它不存在。");
} else {
  const fromSource = extractDiagrams(readFileSync(M9_SOURCE, "utf8").replace(/\r\n?/g, "\n"));
  const fromJson = (m9 ? m9.cards : []).flatMap((c) => c.diagrams || []);
  check("张数和源文件一致", fromSource.length === fromJson.length,
    `源文件 ${fromSource.length} 张 / 产物 ${fromJson.length} 张`);
  const diff = [];
  for (let i = 0; i < Math.max(fromSource.length, fromJson.length); i++) {
    if (fromSource[i] !== fromJson[i]) {
      const a = fromSource[i] || "";
      const b = fromJson[i] || "";
      diff.push(`第 ${i + 1} 张：源文件 ${a.length} 字 / 产物 ${b.length} 字`);
    }
  }
  check("每一张都和源文件逐字相同（没有被截断、没有被改写）", diff.length === 0,
    diff.length ? "\n         " + diff.join("\n         ") : "");
}

console.log("\n── 结构性断言（知识库缺失时的兜底，覆盖不全）──");
/* 半张 flowchart 不是"内容少了一点"，是语法错误 —— 渲染器只会给一个报错框。
   而它最可能的来因就是截断，所以这两条断言直接对着截断。 */
const BAD_HEAD = diagrams.filter(
  (d) => !/^(flowchart|graph|mindmap|sequenceDiagram|classDiagram|stateDiagram)\b/.test(d.src.trim())
);
check(
  "首行是 mermaid 的图类型声明",
  BAD_HEAD.length === 0,
  BAD_HEAD.map((d) => `${d.card}: ${d.src.slice(0, 24)}…`).join(" / ")
);

/* 截断的特征：最后一行是个**不完整的**连线（以 --> 或 -. 收尾，右边没有节点）。
   这一条是我能想到的、既能抓住截断又不会误报正常图的判据。 */
const TRUNCATED = diagrams.filter((d) => {
  const last = d.src.trim().split("\n").pop().trim();
  return /(-->|-\.->|---|\|)$/.test(last);
});
check(
  "末行不是断掉的连线（截断的特征）",
  TRUNCATED.length === 0,
  TRUNCATED.map((d) => `${d.card}: …${d.src.trim().slice(-24)}`).join(" / ")
);

const UNBALANCED = diagrams.filter((d) => (d.src.match(/"/g) || []).length % 2 !== 0);
check(
  "引号成对（节点标签截在中间会落单）",
  UNBALANCED.length === 0,
  UNBALANCED.map((d) => d.card).join(" / ")
);

const HAS_CR = diagrams.filter((d) => /\r/.test(d.src));
check(
  "图源里没有裸 \\r（混进去会让 mermaid 的行解析出奇怪结果）",
  HAS_CR.length === 0,
  HAS_CR.map((d) => d.card).join(" / ")
);

console.log("\n── excerpt 那边的代码块剥离还在工作 ──");
/* 反向断言：图源被单独抽出来之后，excerpt 里**不该**再出现图的痕迹。
   如果这条红了，说明代码块剥离被改坏了，图会在卡片正文里露出来一大段。 */
const LEAKED = all.filter((c) => /\b(flowchart|graph)\s+(TD|LR|TB|RL)\b/.test(c.card_obj.excerpt));
check("没有图漏进 excerpt", LEAKED.length === 0, LEAKED.map((c) => c.card).join(" / "));

console.log("\n── 脱敏（图源是一条新开的、绕过 excerpt 的输出路径）──");
/* ⚠️ 这一条的理由：图源是**新增的**一条从 Obsidian 流向公开仓库的路径。
   现在 M9 六张图里确实没有公司名（人工看过），但"现在没有"不是"以后不会有" ——
   脱敏要按路径挂，不按当次内容挂。这里只查最硬的那几个词。 */
const LEAK_WORDS = [/某跨境优惠券平台/, /内部后台系统/, /HD[- ]?AI[- ]?Center/i];
const LEAKY = diagrams.filter((d) => LEAK_WORDS.some((w) => w.test(d.src)));
check(
  "图源里没有未脱敏的公司名/内部系统名",
  LEAKY.length === 0,
  LEAKY.map((d) => d.card).join(" / ")
);

console.log("");
if (fail) {
  console.log(`!! ${fail} 条断言不过`);
  process.exit(1);
}
console.log("全部断言通过");
