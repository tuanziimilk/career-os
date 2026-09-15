/* 脱敏的第二道防线：对着**产物**扫，而不是对着规则扫。
 *
 * ══════════ 为什么需要第二道 ══════════
 *
 * 第一道是三层过滤（REDACT 替换词 / EXCLUDE_TITLE_PATTERNS 整卡排除 /
 * DROP_LINE_PATTERNS 行级丢弃），它们都在 import-content.mjs 里，
 * 共同的弱点是：**它们只拦我想到的情形**。
 *
 * 而已经查实的两个"靠运气挡住"的例子说明想不到是常态：
 *
 *   1. `面试题库.md` 里有「→ 归 M9 图 5 Reliability（**你的短板**）」
 *      「（**头号短板**）」「以下是**你目前答不出**或答得散的题」。
 *      `EXCLUDE_TITLE_PATTERNS` 对题库解析**完全不生效**（它只在模块解析里被调用），
 *      这些行现在没进产物的唯一原因是：它们在 `## 📦 外部面经补充题` 那一节，
 *      而解析在 `## 通用必考题` 处就 break 了。
 *      **也就是说保护它们的是一个和脱敏毫无关系的、为了别的目的写的 break。**
 *      哪天那一节被挪到 M8 前面，或者 break 的条件改了，它们就直接进产物。
 *
 *   2. M10 的第 1 节标题「逐条是什么」是个完全正当的知识标题，
 *      正文里却夹着「**和我的连接**：我的 Obsidian 双链库…」。
 *      按标题排除挡不住，只是因为 excerpt 截断在 600 字才没露出来 —— 又是运气。
 *
 * 所以这一道**不看规则、不看来源，只看产物里最后有什么字**。
 * 它抓的正是我在前三层里想漏的东西。
 *
 * ══════════ 词表怎么定的 ══════════
 *
 * 只收「出现即泄漏」的词，不收「可能是泄漏」的词。理由和别处一样：
 * 一个会误报的闸门会被学会忽略，那比没有闸门更糟。
 *
 * 所以「我」「你」「简历」「经历」这类高频字**不在**词表里 ——
 * 知识笔记里到处都是「你已经全做过」「结合你的经验」，那些是正当的教学口吻。
 * 词表要的是「短板」「现状自检」这种**只可能出现在自评语境**的词。
 *
 * ⚠️ 这个词表覆盖不全，而且必然覆盖不全。它不是"扫过就安全了"的证明，
 * 只是把已经踩过的坑钉住。真正的防线仍然是人工 review
 * （见 content-review.json —— 那一份记录的是"谁在哪一天看过哪一版"）。
 */
import { requireRedactList, leakWords } from "./redact.mjs";

/** 出现在产物里即视为泄漏的词。每条都注明为什么。 */
const GENERIC_LEAK_WORDS = [
  // —— 自评 / 自曝短板 ——
  [/短板/, "自曝短板。已查实：面试题库里有「（你的短板）」「（头号短板）」"],
  [/现状自检/, "自评小节标题。M8 第 3 节的真实案例"],
  [/自我评估/, "同上"],
  [/你目前答不出/, "已查实：面试题库第 110 行，直接写明哪些题答不出"],
  [/答不出或答得散/, "同上"],
  [/我的连接/, "M10 的自述行标记"],
  [/最真诚的切入点/, "M10 的自述"],
  [/别人抄不走/, "面试题库里的独家答案标记，属于战术信息"],

  /* —— 求职语境的通用措辞。不指认任何对象，所以留在可公开的这一侧 ——
     它们抓的是「这段内容是在讲某家具体公司 / 在讲我的投递计划」这个**形态**，
     而不是某个名字。名字那一类在 redact.local.mjs 里。 */
  [/愿景原话|招聘文档/, "引用了某家公司自己的文件，是可搜索的指纹"],
  [/英雄帖/, "招聘文档里的说法，出现即说明这段在讲某家具体公司"],
  [/Plan\s*[ABC]/i, "求职方案代号，只出现在私人规划语境"],
  [/投递时附上/, "投递动作计划，不是知识"],

  /* —— 身份类词条已搬到 redact.local.mjs（不进版本库）——
     2026-09-15 搬的。原来这里逐条列着前雇主全称、内部系统缩写、内部平台代号、
     在投的目标公司名 —— 而这个文件在公开仓库里。
     词表是为了防泄漏而存在的，结果它自己成了泄漏源。

     上面那些**通用自评措辞**（短板 / 现状自检 / 你目前答不出…）刻意留在这里：
     它们暴露的只是「我在过滤哪一类表达」，不指认任何具体对象，
     而且留在仓库里才能被 eval-leaks.mjs 的断言压住。判据见 redact.example.mjs。 */

  /* ⚠️ 这一条查的是**脱敏替换词本身**，思路和上面几条相反：
     「某目标公司」是替换的结果，它出现在产物里说明
     **有一段围绕具名公司写的内容活了下来**，只是名字被抹了。
     而名字只是指纹之一 —— 实测的真实案例是那一行接着引了公司愿景原话的逐字原文，
     两句话随便一搜就知道是谁。名字抹了，指纹还在。
     所以判据不是"名字露没露"，是"这段内容是不是在讲某一家具体公司"。
     它留在这个可公开的文件里，是因为「某目标公司」本身就是脱敏后的词。 */
  [/某目标公司/, "围绕具名公司写的内容活了下来（名字被抹了，引文指纹还在）"],
];

/* 通用词条（上面，可公开）+ 身份类词条（redact.local.mjs，不进仓库）。
   本地词表缺失时 requireRedactList 会打印「身份类断言未执行」——
   那句话说的是**没执行**，不是**通过了**。 */
requireRedactList("产物泄漏扫描");
export const LEAK_WORDS = [...GENERIC_LEAK_WORDS, ...leakWords()];

/**
 * 扫描产物。
 * @param {{name: string, items: {id: string, text: string}[]}[]} products
 * @returns {{product: string, id: string, word: string, why: string, context: string}[]}
 */
export function scanLeaks(products) {
  const hits = [];
  for (const p of products) {
    for (const item of p.items) {
      const text = String(item.text || "");
      for (const [pat, why] of LEAK_WORDS) {
        const m = text.match(pat);
        if (!m) continue;
        const at = m.index || 0;
        hits.push({
          product: p.name,
          id: item.id,
          word: m[0],
          why,
          context: text.slice(Math.max(0, at - 40), at + 40).replace(/\n/g, " ⏎ "),
        });
      }
    }
  }
  return hits;
}

/** 把 modules.json 的结构摊平成 scanLeaks 要的形状。图源也要扫 —— 它是新开的一条输出路径。 */
export function modulesToItems(modules) {
  return modules.flatMap((m) =>
    m.cards.map((c) => ({
      id: `${m.id} / ${c.id} ${c.title}`,
      text: [c.title, c.excerpt, ...(c.diagrams || [])].join("\n"),
    }))
  );
}

/** 同上，questions.json。 */
export function questionsToItems(questions) {
  return questions.map((q) => ({
    id: `${q.module} / ${q.id}`,
    text: [q.question, q.answer].join("\n"),
  }));
}

export function printLeaks(hits) {
  for (const h of hits) {
    console.error(`   ✗ [${h.product}] ${h.id}`);
    console.error(`     命中「${h.word}」—— ${h.why}`);
    console.error(`     上下文：…${h.context}…`);
  }
}
