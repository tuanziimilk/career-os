#!/usr/bin/env node
// Obsidian → 工作台内容数据 的单向导入脚本。可重复运行，幂等。
//
// 内容与状态分离原则（见 plan 第三节）：这里只产出"内容"——模块标题、
// 知识点卡片、题干、答案——不产出任何"状态"（未读/在读/已懂、会/不会）。
// 状态永远来自 Supabase（用户在工作台/扩展里操作产生），内容永远来自这里。
//
// 用法：node scripts/import-content.mjs
//   之后必须人工 review 输出的 src/data/modules.json / questions.json，
//   确认没有公司名/内部系统名/个人短板自评原文——这是硬性红线，
//   脚本只做脱敏词替换，不能替代人工过一遍的判断。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_ROOT = path.resolve(__dirname, "../../career-knowledgebase");
const NOTES_DIR = path.join(KB_ROOT, "03-学习笔记");
const QUESTIONS_FILE = path.join(KB_ROOT, "05-资源库/面试题库.md");
const OUT_DIR = path.resolve(__dirname, "../src/data");

// ---------------------------------------------------------------- 脱敏词典
// 这里只是兜底替换，不是唯一防线——脚本产出后必须人工 review 一遍。
const REDACT = [
  [/某跨境优惠券平台/g, "某跨境优惠券平台"],
  [/内部后台系统/g, "内部后台系统"],
  [/HD[- ]?AI[- ]?Center|内部 AI 数据平台/g, "内部 AI 数据平台"],
  [/内部 AI 数据平台/gi, "内部 AI 数据平台"],
];

function redact(text) {
  return REDACT.reduce((s, [pat, rep]) => s.replace(pat, rep), text);
}

// 整卡排除（按标题）——这类内容不是"教什么"，是"我自己准备得怎么样"，
// 是私人自评，不该出现在可能给面试官看的公开工作台里。
// 首次运行时发现的真实案例：M8「我的现状自检（对着帖子四条打分）」
// 里有"我的短板集中在……"这种自曝短板的句子——脱敏词典替换不了这种，
// 只能整卡不收。
const EXCLUDE_TITLE_PATTERNS = [/现状自检/, /短板/, /自我评估/];

function isExcludedTitle(title) {
  return EXCLUDE_TITLE_PATTERNS.some((p) => p.test(title));
}

function readFile(p) {
  return fs.readFileSync(p, "utf-8");
}

// ---------------------------------------------------------------- 面试题库解析
// 规整格式（M1~M8）："## Mx · 标题（详见 [[链接]]）" 下面跟 "- **问题？** 答案"
// M9 之后的"外部面经补充题"多数只有问题没答案，格式不规整，本轮不纳入
// （宁可少收，不假装有答案——`## 通用必考题` 出现时即停止解析）。
function parseQuestions(raw) {
  const text = redact(raw);
  const lines = text.split("\n");
  const out = [];
  let currentModule = null;
  let idx = 0;

  for (const line of lines) {
    const modMatch = line.match(/^##\s*(M\d+)\s*·\s*([^（(]+)/);
    if (modMatch) {
      currentModule = modMatch[1];
      continue;
    }
    // 一旦碰到"通用必考题"这类非模块化章节，停止收录——那部分格式不规整，
    // 后续可以单独跑一版更宽松的解析规则，但不该混进这一批。
    if (/^##\s*通用必考题/.test(line)) break;

    const qa = line.match(/^\s*-\s*\*\*(.+?)\*\*\s*(.+)$/);
    if (qa && currentModule) {
      idx += 1;
      out.push({
        id: `${currentModule.toLowerCase()}-q${idx}`,
        module: currentModule,
        question: qa[1].trim(),
        answer: qa[2].trim(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 学习模块解析
// M9 天然是"图1~图6"的三段式结构（三句话讲清/母案例/trade-off），
// 直接按 "## 图 N ·" 切成卡片；其余模块按顶级 "## N. 标题" 切成卡片，
// 只取小节标题作为卡片标题、正文作为摘要（截断，工作台只做速览，
// 完整内容仍以 Obsidian 为准，不在网页上囤全文）。
const CARD_EXCERPT_MAX = 600;

function excerpt(body) {
  const clean = body
    .replace(/```[\s\S]*?```/g, "") // 代码块整段丢弃，避免截断在代码中间
    .replace(/\n{2,}/g, "\n")
    .trim();
  return redact(clean).slice(0, CARD_EXCERPT_MAX);
}

function parseModuleFile(moduleId, raw) {
  const text = redact(raw);
  // M9 用"图 N"切分，其余模块用顶级"## "切分
  const isM9 = moduleId === "M9";
  const headingPat = isM9 ? /^##\s*图\s*(\d+)\s*·\s*(.+)$/ : /^##\s*(\d+)\.\s*(.+)$/;

  const lines = text.split("\n");
  const cards = [];
  let cur = null;

  function push() {
    if (cur && cur.body.trim() && !isExcludedTitle(cur.title)) {
      cards.push({
        id: `${moduleId.toLowerCase()}-c${cards.length + 1}`,
        title: cur.title,
        excerpt: excerpt(cur.body),
      });
    }
  }

  for (const line of lines) {
    const m = line.match(headingPat);
    if (m) {
      push();
      cur = { title: m[2].trim(), body: "" };
      continue;
    }
    if (cur) cur.body += line + "\n";
  }
  push();
  return cards;
}

const MODULE_TITLES = {
  M1: "RAG",
  M2: "Agent",
  M3: "Eval",
  M4: "产品方法论",
  M5: "大模型八股",
  M6: "AI-SEO-GEO",
  M7: "数据分析",
  M8: "AI产品落地能力",
  M9: "Agent系统脑图",
};

const MODULE_FILES = {
  M1: "M1-RAG.md",
  M2: "M2-Agent.md",
  M3: "M3-Eval.md",
  M4: "M4-产品方法论.md",
  M5: "M5-大模型八股.md",
  M6: "M6-AI-SEO-GEO.md",
  M7: "M7-数据分析.md",
  M8: "M8-AI产品落地能力.md",
  M9: "M9-Agent系统脑图.md",
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- 模块 ----
  const modules = [];
  for (const [id, file] of Object.entries(MODULE_FILES)) {
    const fp = path.join(NOTES_DIR, file);
    if (!fs.existsSync(fp)) {
      console.warn(`⚠ 找不到 ${file}，跳过 ${id}`);
      continue;
    }
    const cards = parseModuleFile(id, readFile(fp));
    modules.push({ id, title: MODULE_TITLES[id] || id, cards });
    console.log(`  ${id} · ${MODULE_TITLES[id]}：${cards.length} 张卡片`);
  }
  fs.writeFileSync(
    path.join(OUT_DIR, "modules.json"),
    JSON.stringify(modules, null, 2) + "\n",
    "utf-8"
  );

  // ---- 面试题 ----
  if (!fs.existsSync(QUESTIONS_FILE)) {
    console.warn(`⚠ 找不到面试题库：${QUESTIONS_FILE}`);
    fs.writeFileSync(path.join(OUT_DIR, "questions.json"), "[]\n", "utf-8");
  } else {
    const questions = parseQuestions(readFile(QUESTIONS_FILE));
    fs.writeFileSync(
      path.join(OUT_DIR, "questions.json"),
      JSON.stringify(questions, null, 2) + "\n",
      "utf-8"
    );
    console.log(`  面试题：${questions.length} 条（仅 M1~M8 规整问答对，M9 外部题待补答案后再收）`);
  }

  console.log("\n✅ 导入完成。接下来必须人工 review：");
  console.log("   src/data/modules.json");
  console.log("   src/data/questions.json");
  console.log("   确认没有公司名/内部系统名/个人短板自评原文，再提交进仓库。");
}

main();
