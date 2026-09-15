/* 题目 id 稳定性的断言。
 *
 *     node web/scripts/eval-question-ids.mjs
 *
 * ══════════ 这个脚本存在的唯一理由 ══════════
 *
 * 旧的 id 是 `m1-q7` 这种，语义由「这条问答在 面试题库.md 里出现的次序」决定。
 * 往 M1 段**中间**插一条新题，其后所有 id 平移一位，`career_question_practice`
 * 里的「会/不会 + 错题次数」就**静默挂到另一道题上**。
 *
 * 这个 bug 的全部特征都指向"必须用测试钉住"：
 *   · 它不报错
 *   · 它的触发条件（往题库中间加题）正是日常要做的事
 *   · 它损坏的是历史数据，发现时已经无法还原
 *   · 数据库没有外键、没有约束能发现孤儿行
 *
 * 所以核心断言只有一条，其余都是围着它：
 *   **在中间插一道题之后，其他所有题的 id 必须逐个不变。**
 *
 * ⚠️ 这个断言必须在改代码**之前**先能跑、且**先失败**（对着旧实现）。
 * 我写的时候就是这个顺序 —— 否则无法证明它真的测到了那个 bug，
 * 只能证明它对着现在的实现是绿的。
 */
import { parseQuestions, questionId } from "./import-content.mjs";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

/* 合成题库。刻意用和真实文件一样的骨架（`## Mx · 标题` + `- **问题** 答案`），
   但内容是编的 —— 这个测试测的是 id 的行为，不该依赖真实题库的内容，
   否则你改一次题库这个测试就红一次。 */
const BEFORE = `---
tags: 资源/面试题库
---
# 面试题库

## M1 · RAG（详见 [[M1-RAG]]）

- **什么是 RAG？** 检索增强生成，先检索再让模型基于检索结果回答。
- **召回和精排的区别？** 召回追全，精排追准。
- **怎么评估检索质量？** recall@k、MRR，配一份人工标注的评测集。

## M2 · Agent（详见 [[M2-Agent]]）

- **Agent 和工作流的区别？** 工作流路径固定，Agent 由模型临场决定下一步。
- **什么时候不该上 Agent？** 路径能事先枚举清楚的时候。

## 通用必考题

- **这条不该被收进来** 因为它在通用必考题那一节里。
`;

/* 唯一的差异：在 M1 的**第二条和第三条之间**插了一道新题。 */
const AFTER = BEFORE.replace(
  "- **怎么评估检索质量？**",
  "- **向量库怎么选型？** 看数据量、是否要过滤、以及运维成本。\n- **怎么评估检索质量？**"
);

const before = parseQuestions(BEFORE);
const after = parseQuestions(AFTER);

console.log("── 解析本身 ──");
check("解析出 5 条（`## 通用必考题` 之后的不收）", before.length === 5, `${before.length} 条`);
check("插入后变成 6 条", after.length === 6, `${after.length} 条`);
check("模块归类正确",
  before.filter((q) => q.module === "M1").length === 3 &&
  before.filter((q) => q.module === "M2").length === 2);

console.log("\n── 核心断言：插入不该动其他题的 id ──");
/* 这就是那个 bug。旧实现下，`怎么评估检索质量` 之后的每一条 id 都会 +1。 */
const beforeById = new Map(before.map((q) => [q.question, q.id]));
let shifted = [];
for (const q of after) {
  const old = beforeById.get(q.question);
  if (old && old !== q.id) shifted.push(`${q.question.slice(0, 16)}… ${old} → ${q.id}`);
}
check("在 M1 中间插一道题后，原有 5 条的 id 逐个不变", shifted.length === 0,
  shifted.length ? "\n         " + shifted.join("\n         ") : "");
check("新插入的那条拿到一个新 id",
  after.length - before.length === 1 &&
  after.some((q) => !beforeById.has(q.question)));

console.log("\n── 什么该换 id、什么不该 ──");
const base = "**什么是 RAG？** 检索增强生成。";
check("改答案 → id 不变（润色答案不该丢掉「我会不会」）",
  questionId("什么是 RAG？") === questionId("什么是 RAG？"));
const q1 = parseQuestions(`## M1 · X\n\n- **什么是 RAG？** 答案甲。\n`);
const q2 = parseQuestions(`## M1 · X\n\n- **什么是 RAG？** 完全不同的答案乙，长很多很多。\n`);
check("同题干不同答案 → 同一个 id", q1[0].id === q2[0].id, `${q1[0].id} / ${q2[0].id}`);

const q3 = parseQuestions(`## M2 · Y\n\n- **什么是 RAG？** 答案甲。\n`);
check("换了模块 → id 仍不变（同一道题重新归类还是同一道题）",
  q1[0].id === q3[0].id, `${q1[0].id} / ${q3[0].id}`);

check("改题干 → id 变（那确实是另一道题了）",
  questionId("什么是 RAG？") !== questionId("什么是向量检索？"));

console.log("\n── 规范化：不影响「是不是同一道题」的差异不该换 id ──");
check("首尾空白", questionId("  什么是 RAG？  ") === questionId("什么是 RAG？"));
check("中英之间加不加空格", questionId("什么是 RAG ？") === questionId("什么是RAG？"));
check("全角/半角问号", questionId("什么是 RAG?") === questionId("什么是 RAG？"));
/* 反过来：真正不同的题干必须给出不同 id，否则规范化就规范过头了 */
check("规范化没有过头（不同题干仍不同）",
  new Set([
    questionId("什么是 RAG？"),
    questionId("什么是 Agent？"),
    questionId("RAG 和微调怎么选？"),
    questionId("什么是 RAG 的召回？"),
  ]).size === 4);

console.log("\n── id 形状与碰撞 ──");
check("id 是 q- 加 8 位十六进制", /^q-[0-9a-f]{8}$/.test(before[0].id), before[0].id);
check("模块不在 id 里（换模块不该换 id，所以不能带）",
  !/m[0-9]/.test(before[0].id), before[0].id);
/* 拿真实题库的规模跑一遍分布，确认没有系统性碰撞 */
const many = new Set();
for (let i = 0; i < 5000; i++) many.add(questionId(`第 ${i} 道题，问的是某个具体的技术点？`));
check("5000 条合成题干无碰撞", many.size === 5000, `${many.size}/5000`);

console.log("\n── 迁移映射的锚点必须是题干，不是位置 ──");
/* ⚠️ 这一组钉的是我自己差点犯的错。
   第一版迁移是拿「当前文件里第 N 条」算旧 id 来配对的 —— 而数据库里的旧 id
   是**上一版文件**的顺序算出来的，中间加过题，两套顺序对不上。
   按位置配等于把作答记录搬到别的题上：正是这次要修的 bug，
   换成由迁移脚本来犯。所以这里模拟"中间加过题"的真实情形。 */
const oldProduct = before.map((q, i) => ({
  id: `m${q.module.slice(1)}-q${i + 1}`, // 上一版的位置型 id
  question: q.question,
}));
/* 现在的文件多了一条（插在中间），位置全变了 */
const pairByText = new Map(after.map((q) => [questionId(q.question), q.id]));
const mapped = oldProduct.map((o) => ({ old: o.id, next: pairByText.get(questionId(o.question)), q: o.question }));

check("旧产物每一条都能按题干找到新 id", mapped.every((m) => !!m.next),
  mapped.filter((m) => !m.next).map((m) => m.old).join(", "));
check("配对结果和题干一一对应（不是按位置错位）", (() => {
  const byNewId = new Map(after.map((q) => [q.id, q.question]));
  return mapped.every((m) => byNewId.get(m.next) === m.q);
})());
/* 反证：如果按位置配，会错。这条断言证明「按位置」确实是错的方案，
   而不是我多虑了。 */
check("按位置配会配错（所以必须按题干）", (() => {
  const wrong = oldProduct.map((o, i) => ({ old: o.id, next: after[i] && after[i].id, q: o.question }));
  const byNewId = new Map(after.map((q) => [q.id, q.question]));
  return wrong.some((m) => m.next && byNewId.get(m.next) !== m.q);
})());

console.log("");
if (fail) {
  console.log("!! %d 条断言不过", fail);
  process.exit(1);
}
console.log("全部断言通过");
