/* 脱敏词表的断言。
 *
 *     node career-web/scripts/eval-leaks.mjs
 *
 * ══════════ 为什么这个脚本必须存在 ══════════
 *
 * `scanLeaks()` 现在对着真实产物跑是**全绿的**。而一道从不报错的闸门和没有闸门
 * 没有区别 —— 全绿可能是因为产物真的干净，也可能是因为词表根本不工作。
 * 这个脚本用**已经查实的真实泄漏文本**去撞它，证明它会红。
 *
 * 两组断言的分量是一样的：
 *   · 该抓的抓到（拿知识库里真实存在的自评原文去撞）
 *   · 不该抓的别抓（拿正当的知识内容去撞）
 *
 * 第二组不是凑数。词表里差点写进 `/面试/` —— 九个模块里有 22 个标题带"面试"
 * （「面试高频问答」「面试高频对比」「术语中英对照（面试用）」），
 * 那会把知识库删掉一大片，然后我就会学会忽略这个闸门的输出。
 */
import { scanLeaks } from "./leaks.mjs";
import { leakSamples } from "./redact.mjs";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

function scan(text) {
  return scanLeaks([{ name: "t", items: [{ id: "x", text }] }]);
}
const flagged = (text) => scan(text).length > 0;

console.log("── 该抓的：知识库里真实存在的泄漏文本 ──");
/* ⚠️ 下面每一条都是从 career-knowledgebase 里逐字抄的，不是我编的样例。
   注明出处，这样将来有人觉得某条是误报时，能去看原文再判断。 */
const MUST_FLAG = [
  ["面试题库.md:122", "**→ 归 M9 图 5 Reliability（你的短板）**"],
  ["面试题库.md:128", "**→ 归 M9 图 6 Evaluation（头号短板）**"],
  ["面试题库.md:110", "以下是**你目前答不出或答得散**的题，按 M9 六图归位"],
  ["面试题库.md:135", "这是**别人抄不走的独家答案**，务必写完整"],
  ["M8:199", "## 3. 我的现状自检（对着帖子四条打分）"],
  ["M8:208", "结论：我的短板集中在“Agent 异常设计”这一条"],
  ["M10:54", "**和我的连接**：我的 Obsidian 双链库，本质就是概念图实践"],
  ["M10:58", "我是**先做后知道**的，这是我最真诚的切入点"],
  ["M10:31", "他们的愿景原话是「提升每个人获得信息的质量」"],
];

/* 带身份词的样本从 redact.local.mjs 取（不进版本库）——
   证明词表有效的断言必须拿真实泄漏文本去撞，而那些文本里就带着要脱敏的词。 */
MUST_FLAG.push(...leakSamples());

for (const [where, text] of MUST_FLAG) {
  check(`${where}  「${text.slice(0, 22)}…」`, flagged(text));
}

console.log("\n── 脱敏替换后仍然要抓的（名字抹了，指纹还在）──");
/* 这一条钉的是我自己 review 时抓到的那个情形：
   REDACT 把公司名换成「某目标公司」，那一行看起来脱敏了 ——
   但后半句逐字引了公司愿景，两句话随便一搜就知道是谁。 */
check(
  "「为什么 某目标公司 关心这些」这种替换后的残留",
  flagged("**为什么 某目标公司 关心这些**：他们的愿景原话是「提升每个人获得信息的质量」")
);
check("单独出现替换词也要抓", flagged("某目标公司 的岗位设置"));

console.log("\n── 不该抓的：正当的知识内容 ──");
/* 全部是产物里真实存在的标题和句子。任何一条被抓 = 这个闸门开始误伤知识库。 */
const MUST_NOT_FLAG = [
  "## 8. 面试高频问答(背这些)",
  "## 7. RAG vs 微调(Fine-tuning)——面试高频对比",
  "## 9. 术语中英对照(面试/看英文文档用)",
  "## 5. Agent vs 工作流 vs RAG（★面试最爱问的辨析）",
  "## 3. A/B 测试（简单实验思维）★ 面试爱问",
  "怎么判断你的评测结论可不可信？看用例数。",
  "你已经全做过（需求拆解、竞品分析），本模块是给这四步配上标准话术。",
  "召回追全，精排追准。",
  "数据在你自己手里，同时又能实时协作。技术底座是 CRDT / Automerge。",
  "内部后台系统 重构：把散在 4 个老后台的商家数据收口成单一实体",
  "flowchart TD\n    A[\"User / Trigger\"] --> B[\"Intent / Goal\"]",
];
for (const text of MUST_NOT_FLAG) {
  const hits = scan(text);
  check(
    `「${text.slice(0, 26).replace(/\n/g, " ")}…」`,
    hits.length === 0,
    hits.length ? `误报命中「${hits[0].word}」` : ""
  );
}

console.log("\n── 扫描结果本身要够用来定位 ──");
const one = scan("**→ 归 M9 图 5 Reliability（你的短板）**")[0];
check("给出命中的词", one && one.word === "短板", one && one.word);
check("给出为什么（不然改词表的人不知道能不能删）", !!(one && one.why));
check("给出上下文片段", !!(one && one.context && one.context.includes("Reliability")));

console.log("\n── 多条产物一起扫 ──");
const multi = scanLeaks([
  { name: "modules.json", items: [{ id: "m8-c3", text: "我的现状自检" }] },
  { name: "questions.json", items: [{ id: "q-1", text: "召回追全，精排追准。" }] },
]);
check("命中里带产物名（两份产物要能分开）", multi.length === 1 && multi[0].product === "modules.json");

console.log("");
if (fail) {
  console.log(`!! ${fail} 条断言不过`);
  process.exit(1);
}
console.log("全部断言通过");
