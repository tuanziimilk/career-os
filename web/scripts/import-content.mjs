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
import { scanLeaks, modulesToItems, questionsToItems, printLeaks } from "./leaks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* ⚠️ 知识库**不在这个仓库里**，它是仓库的兄弟目录，从来没进过版本控制。
 *
 * 2026-09-15 单仓库合并把这条路径打断了，而且是**静默**打断的：
 * 合并前 `__dirname` 是 `career-web/scripts`，`../../` 正好是两个仓库的公共父目录；
 * 合并后 `__dirname` 变成 `<repo>/web/scripts`，`../../` 变成了 `<repo>` ——
 * 指向一个不存在的 `<repo>/career-knowledgebase`。
 *
 * 后果比"路径错了"严重：所有模块文件都找不到 → 只打 `⚠ 找不到…跳过` 的警告 →
 * `modules` 是空数组 → `guardDiagrams` 因为找不到 M9 直接 return（它只拦
 * "M9 在但图是 0"）→ 然后**把 modules.json 覆盖成 `[]`**。
 * 89 张卡连同它们的云端学习进度一起变成孤儿，而脚本退出码是 0。
 *
 * 这正是 CRLF 那次静默清空题库的同一个模式，换了个触发原因。
 * 所以除了修路径，下面还给 modules.json 补了 guardShrink（原来只有题库有）。
 *
 * 两个位置都找，仓库内优先 —— 将来真把知识库纳进版本控制时不用再改这里。
 * 写法和 `check-line-endings.mjs` 保持一致，那边同一个坑已经踩过一次。
 */
const KB_ROOT =
  [
    path.resolve(__dirname, "../../career-knowledgebase"),
    path.resolve(__dirname, "../../../career-knowledgebase"),
  ].find((p) => fs.existsSync(p)) || path.resolve(__dirname, "../../../career-knowledgebase");
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
  /* 2026-09-11 随 M10 一起加的：**在投的目标公司名**。
     M10 整篇是围绕一家具名公司的招聘文档写的（连它的岗位名、愿景原话都在里面）。
     公开产物里出现"我正在准备投这家公司、这是我的话术"，性质和公司名脱敏是一样的 ——
     只不过泄漏的是**求职意图**而不是前雇主信息。 */
  [/某目标公司/gi, "某目标公司"],
  [/某目标公司产品/gi, "某目标公司产品"],

  /* 2026-09-15 · 仓库确定要公开之后加的四条。
     来源是 `docs/内容review-待确认_2026-09-15.md` 里人工挑出的重点候选，
     由 Zoe 逐条确认「都脱敏」。

     ⚠️ 前三条的共同形态值得记下来：**两个大写字母的代号 + 中文产品名**
     （内容质检平台 / 内部 AI 策略工作台），或者 **「XX基础库」**。
     这是内部系统命名的典型样子，而词表层的 `scanLeaks()` 抓不到它们 ——
     它只认已知的词。所以这一类只能靠人读一遍产物，
     这也正是签章那道闸门存在的理由。 */
  // ① SC 家族。写成一条是因为顺序敏感：先匹配长的，否则「内容质检平台」
  //    会被「内容质检平台」里的片段抢先替换掉。
  [/SC\s?(内容)?质检平台|SC\s?平台/g, "内容质检平台"],
  // ② 代号像业务线缩写
  [/CP\s+Strategy\s+OS/gi, "内部策略工具"],
  // ③ 「XX基础库」是内部系统的常见命名
  [/内部主数据库/g, "内部主数据库"],
  /* ④ 具体的内部指标数字。不是名字，但可能比名字更敏感 ——
     一个精确到小数点后一位的准确率，配上「数据治理项目」的上下文，
     足够让知情的人对上号。替换成 XX% 而不是删掉整句：
     句子仍然读得通（「程序规则基线 XX% → LLM 大幅提升」），
     而且 XX% 这个形状会明白地告诉读者**这里被脱敏过**，
     不像删掉那样让人以为原文就没有数字。 */
  [/23\.3\s?%/g, "XX%"],
];

/* ⚠️ 改过三版才定下现在这个形状，前两版怎么失败的值得记下来，别再走一遍：
 *
 * 第一版：把「结合你」这类词逐个替换成「举例」。
 *   结果是语义对了、中文不通 ——「举例：例如数据治理项目里做的」
 *   「举例：其实就是在用 Embedding…」，接缝处全是重复的连接词。
 * 第二版：给每个坏掉的接缝再加一条整句替换规则。
 *   每扫一遍产物就冒出新的坏句：`(贴你背景)` 那个半角括号变体、
 *   「就是例如 query 与页面语义相似度匹配」、丢了主语的
 *   「其实早就会 RAG 最核心的检索环节了」。
 *   **这是在用替换规则做编辑工作**，而编辑工作没有收敛点。
 *
 * 第三版（现在）分两类，判据是**这句话拿掉「你」之后还剩不剩东西**：
 *
 *   A. 整行/整卡丢掉 —— 那些**存在的唯一目的就是把内容绑到她真实经历上**的
 *      注解。原文里它们都有明确标记（`🎯 结合你`、`🎯 贴你背景`、
 *      `## N. 结合你的经历：…`）。拿掉「你」之后剩下的是项目描述本身，
 *      而那恰恰是公开仓库最不该留的东西。**删除永远不会产出病句。**
 *      （规则在 DROP_LINE_PATTERNS 和 EXCLUDE_TITLE_PATTERNS 里）
 *   B. 词级替换 —— 嵌在正常教学句里的短语（`（你的字段提取）`、
 *      `你做过的 FAQ 配备`）。拿掉人称之后句子照样完整。
 *
 * ⚠️ A 类的做法和「改成举例」这个指令有出入，我改了做法并在这里说明：
 * 只换前缀的话，结果是「举例：内部后台系统 里"把 SERP/AIGC 多任务拆分
 * 合并成一个文件上传"」—— 主语没了，事还在，而公开仓库要防的正是后半句。
 * 整段丢掉同时解决了泄漏和病句两件事。
 */
const DEPERSONALIZE = [
  // ── B 类：词级替换，替换后句子仍然完整 ──
  [/你已经全做过/g, "常见的做法是"],
  [/（你已经在做的事，串成故事）/g, "（串成故事）"],
  [/（你已经在定验收标准）/g, ""],
  [/——你已经在写，补规范/g, "——补规范"],
  [/你已经在用/g, "常用"],
  [/能把你现有的/g, "能把现有的"],
  [/这正是你已经在(.{0,12}?)做的/g, "这正是$1在做的"],
  [/你搭过/g, "可用于"],
  [/你最强的/g, "最典型的"],
  [/你做过的/g, "例如"],
  [/你现成的/g, "现成的"],
  [/你现有的/g, "现有的"],
  [/你的工具\/项目/g, "工具/项目"],
  [/你的现有工具/g, "现有工具"],
  [/你的字段提取/g, "字段提取"],
  [/你在数据治理项目做的/g, "数据治理项目里做的"],
  /* 第二遍扫产物补的一组。它们都藏在「动手做个 RAG demo」这类
     教学步骤里，指的是她现有的代码和数据 —— 不涉及雇主，
     但公开之后读起来像是在对某个特定的人说话。 */
  [/[（(]你已有[）)]/g, "（已有）"],
  [/[（(]你熟[）)]/g, ""],
  [/你的相似度逻辑/g, "现有的相似度逻辑"],
  [/[（(]你的多市场?[^）)]*[）)]/g, ""],
  [/你接过/g, "可用于"],
  [/\|\s*你的关联\s*\|/g, "| 关联 |"],
  [/[（(]够用即可，你有基础[）)]/g, "（够用即可）"],
  [/\*\*你实际用过\s*/g, "**"],
  /* 面试题里的「（结合你经历）」只是个标签，题干本身是通用的
     （「你做过模型评测吗」问的是读者，不是她）。
     ⚠️ 替换成**一个空格**不是空串：原文是 `**Q7（结合经历）你做过…`，
     删成空串会粘成 `**Q7你做过…`。 */
  [/[（(]结合(你)?经历[）)]/g, " "],
];

function redact(text) {
  const masked = REDACT.reduce((s, [pat, rep]) => s.replace(pat, rep), text);
  return DEPERSONALIZE.reduce((s, [pat, rep]) => s.replace(pat, rep), masked);
}

// 整卡排除（按标题）——这类内容不是"教什么"，是"我自己准备得怎么样"，
// 是私人自评，不该出现在可能给面试官看的公开工作台里。
// 首次运行时发现的真实案例：M8「我的现状自检（对着帖子四条打分）」
// 里有"我的短板集中在……"这种自曝短板的句子——脱敏词典替换不了这种，
// 只能整卡不收。
const EXCLUDE_TITLE_PATTERNS = [
  /现状自检/,
  /短板/,
  /自我评估/,
  /* 2026-09-11 随 M10 一起加。M10 的第 3、4 节不是"这个领域有什么知识"，
     是**我要怎么跟这家公司说话** —— 里面有逐字的面试话术、承认自己没到的部分、
     以及"投递时附上这个"的动作计划。这类东西进公开产物是最难挽回的一种泄漏：
     面试官看到的不是你的作品，是你准备怎么应付他。

     ⚠️ 这两条模式刻意写得很窄（`面试怎么说` / `写成作品`）。
     光写 `/面试/` 会误伤一大片：九个模块里有 22 个标题带"面试"
     （「面试高频问答」「面试高频对比」「术语中英对照（面试用）」），
     那些是**正当的知识内容**。一个会误伤的排除规则等于把知识库删了一半。 */
  /面试怎么说/,
  /写成作品/,
  /* 2026-09-15 · 仓库公开。这两节的标题就是「结合你的经历：把 X 讲成 Y 叙事
     （★核心产出）」—— 整节内容都是她把自己的项目重讲一遍的稿子，
     不是"这个领域有什么知识"。M2 和 M3 各一张卡，89 → 87。 */
  /结合你的经历/,
  /* 同一类的另外三张，是第二遍扫产物时才发现的 —— 它们的标题里没有「你」，
     所以第一轮按人称扫没扫到：
       · `★ 用方法论重讲 内部后台系统 重构（核心产出）`
       · `★ 你的实战战绩怎么讲（升级叙事）` —— 正文里有**简历上的数字**
         （「ES 市场增长：半年内日均自然流量 +60%」）
       · `★n8n AI 检测流的「兜底化」重讲` —— 她自己那条工作流的改造稿
     共同点是「把我的某个项目重讲一遍」，判据落在「重讲 / 实战战绩」上。 */
  /重讲/,
  /实战战绩/,
];

function isExcludedTitle(title) {
  return EXCLUDE_TITLE_PATTERNS.some((p) => p.test(title));
}

/* 行级丢弃。
 *
 * ⚠️ 为什么需要「整卡排除」之外再来一层：M10 的第 1 节标题是
 * 「逐条是什么」—— 一个**完全正当的知识标题**，正文里却夹着
 * 「**和我的连接**：我的 Obsidian 双链库…」「这是我最真诚的切入点」
 * 这种自述。按标题排除会把整节知识一起扔掉，不排除又会把自述带出去。
 *
 * 这些自述在原文里都有**明确的行首标记**（作者自己加的），所以按行丢是准的。
 * 判据是标记，不是"看起来像自述" —— 后者只能靠猜。
 *
 * 这一层仍然不是最后一道。最后一道是 scanLeaks()：
 * 它查的是**产物本身**，抓的是我在这三层里想漏的东西。
 */
const DROP_LINE_PATTERNS = [
  /\*\*和我的连接\*\*/,
  /\*\*和\s*\S+\s*的连接\*\*/, // 「和 某目标公司 的连接」这种
  /我最真诚的切入点/,
  /诚实承认没到的部分/,
  /诚实边界/,
  /* ⚠️ 这三条是**我自己 review 时抓出来的**，而且它抓的是一个
     「脱敏看起来生效了、其实没有」的情形 —— 值得单独写下来：

     REDACT 把公司名换成了「某目标公司」，那一行读起来是
     「为什么 某目标公司 关心这些：他们的**愿景原话**是「提升每个人获得信息的质量」
       「未来屏幕的交互界面由大模型实时生成、千人千面」」

     名字没了，但**逐字的愿景原话还在** —— 那两句话随便一搜就能定位到是哪家公司。
     替换词典对付得了名字，对付不了**引文指纹**。
     所以凡是"引用某家公司自己的文件"的行，整行不要。 */
  /愿景原话/,
  /招聘文档原话|招聘文档本身/,
  /招聘里有个岗位|招聘文档「/,
  /潜台词/,

  /* 2026-09-15 · 仓库确定公开之后加的一组（DEPERSONALIZE 头部的 A 类）。
     这些行**存在的唯一目的就是把学习内容绑到她的真实经历上**，
     原文里都带 `🎯 结合你` / `🎯 贴你背景` 这种明确标记。
     拿掉人称之后剩下的是项目描述本身（「内部后台系统 里把 SERP/AIGC 多任务拆分
     合并成一个文件上传」），而那正是公开仓库要防的东西 —— 所以整行不要。 */
  /🎯\s*结合你/,
  /🎯\s*贴你背景/,
  /[（(]贴你背景[）)]/,
  /你现成的相似度\s*API/, // 「…还在的话，告诉我用的哪个 embedding」——写给自己的备忘
  /你早就会\s*RAG/,
  /你早就在(做|用)/,
];

function dropLines(body) {
  return body
    .split("\n")
    .filter((l) => !DROP_LINE_PATTERNS.some((p) => p.test(l)))
    .join("\n");
}

/* ⚠️ 必须统一行尾，这是一个**已经潜伏着的静默故障**。
 *
 * 2026-09-11 实测：`面试题库.md` 现在是 CRLF（Obsidian 在 Windows 上存的），
 * 而题库解析用的是 `/^\s*-\s*\*\*(.+?)\*\*\s*(.+)$/` ——
 * **JS 里 `.` 不匹配 `\r`**（它和 `\n` 一样算行终止符）。
 * 于是 `(.+)$` 永远走不到字符串末尾，139 行的题库**一条都匹配不上**。
 *
 * 而模块解析的正则没锚 `$`，照常工作。所以症状是：
 * 模块 85 张卡全在，题目 0 条，脚本**不报错**，然后把 questions.json
 * 覆盖成 `[]` —— 39 道题连同它们在云端的作答记录一起变成孤儿。
 *
 * 没人发现是因为 questions.json 是上次（文件还是 LF 时）生成的，
 * 之后没人重跑过导入。我这次重跑，当场就触发了。
 *
 * 在读取这一层统一，而不是在每条正则上加 `\r?` —— 后者要记得每加一条正则
 * 都写一次，而"记得"是不可靠的。
 */
function readFile(p) {
  return fs.readFileSync(p, "utf-8").replace(/\r\n?/g, "\n");
}

// ---------------------------------------------------------------- 题目 id
//
// ⚠️ 这一段修的是一个**会静默损坏你的作答记录**的 bug。
//
// 原来的 id 是 `${模块}-q${全文件递增序号}`，也就是说 `m1-q7` 的语义完全由
// 「这条问答在 面试题库.md 里出现的次序」决定。后果：
//
//   往 M1 段**中间**插一条新题 → 其后所有题的 id 全部平移一位
//   → career_question_practice 里的「会/不会 + 错题次数」静默挂到另一道题上
//
// 没有外键、没有校验、check-shared 也不管这个。而「扩展题库、补充新知识」
// 恰恰是要做的事——每加一道题就损坏一批历史记录。
//
// 改成**从题干内容派生**。这样：
//   · 插入/删除/重排 → 其他题的 id 纹丝不动
//   · 改答案 → id 不变（你润色答案，不该丢掉"我会不会"）
//   · 改题干 → id 变（那确实是另一道题了，旧记录失效是对的）
//   · 换模块 → id 不变（所以 module **不进** id——同一道题重新归类还是同一道题）
//
// 用 FNV-1a 32 位：够短（8 位十六进制）、无依赖、分布均匀。
// 40~200 条的规模下碰撞概率可忽略，但**仍然显式检测碰撞并报错** ——
// 碰撞的后果是两道题共用一条作答记录，那属于静默数据损坏，不能靠概率兜。
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 乘 16777619，用移位避免 32 位溢出丢精度
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** 题干 → 稳定 id。规范化掉不影响"是不是同一道题"的差异。 */
export function questionId(question) {
  const norm = String(question)
    .trim()
    .replace(/\s+/g, "")          // 空白全删：中英之间加不加空格不该换 id
    .replace(/[？?]$/, "");        // 结尾问号全角半角互换不该换 id
  return "q-" + fnv1a32(norm).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------- 面试题库解析
// 规整格式（M1~M8）："## Mx · 标题（详见 [[链接]]）" 下面跟 "- **问题？** 答案"
// M9 之后的"外部面经补充题"多数只有问题没答案，格式不规整，本轮不纳入
// （宁可少收，不假装有答案——`## 通用必考题` 出现时即停止解析）。
export function parseQuestions(raw) {
  const text = redact(raw);
  const lines = text.split("\n");
  const out = [];
  const byId = new Map();
  let currentModule = null;
  let idx = 0; // 只用于碰撞报错时指出是第几条，不再决定 id

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
      const question = qa[1].trim();
      const id = questionId(question);

      /* 碰撞检测。两种情况都会撞：真·哈希碰撞（极罕见），
         和**题库里有两条一模一样的题**（很常见——从不同来源摘的重复题）。
         后者才是现实中会发生的，而它同样会让两道题共用一条作答记录。
         所以直接报错让人去合并，不静默取其一。 */
      if (byId.has(id)) {
        const prev = byId.get(id);
        console.error(`\n✗ 题目 id 冲突：${id}`);
        console.error(`   已有：[${prev.module}] ${prev.question}`);
        console.error(`   又见：[${currentModule}] ${question}`);
        console.error(
          "   两条题干规范化后完全相同。去 面试题库.md 里合并或改写其中一条 ——\n" +
          "   放着不管的话，它们会共用同一条作答记录。"
        );
        process.exit(1);
      }

      const item = {
        id,
        module: currentModule,
        question,
        answer: qa[2].trim(),
      };
      byId.set(id, item);
      out.push(item);
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
  const clean = dropLines(body)
    .replace(/```[\s\S]*?```/g, "") // 代码块整段丢弃，避免截断在代码中间
    .replace(/\n{2,}/g, "\n")
    .trim();
  return redact(clean).slice(0, CARD_EXCERPT_MAX);
}

/* Mermaid 图源单独抽出来，不走 excerpt。
 *
 * 原因：excerpt 会 ① 整段丢弃代码块 ② 截断到 600 字。M9 六张图正是
 * 「脑图点亮」那一页的**唯一内容源**，被 ① 丢掉了，所以图一直没进工作台。
 *
 * ⚠️ 图源**绝不能截断** —— 半张 flowchart 是语法错误，渲染器只会给一个
 * 报错框。所以这里既不截断也不压缩空行；工作台那边渲不下就滚动/折叠，
 * 不在数据层解决显示问题。
 *
 * 仍然过一遍 redact：图里写的是 SEO Agent 母案例，现在没有公司名，
 * 但「现在没有」不是「以后不会有」，脱敏是按路径挂的，不按内容挂。
 */
export function extractDiagrams(body) {
  const out = [];
  const pat = /```mermaid\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = pat.exec(body)) !== null) {
    const src = redact(m[1]).replace(/\s+$/, "");
    if (src.trim()) out.push(src);
  }
  return out;
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
      const diagrams = extractDiagrams(cur.body);
      const card = {
        id: `${moduleId.toLowerCase()}-c${cards.length + 1}`,
        title: cur.title,
        excerpt: excerpt(cur.body),
      };
      // 没有图的卡片不写这个字段（占 85 张卡里的 79 张），省得 json 里
      // 满屏空数组，也让"哪些卡有图"一眼能看出来。
      if (diagrams.length) card.diagrams = diagrams;
      cards.push(card);
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
  M10: "前沿理念地图",
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
  /* M10 是本轮（P1.3）才纳入的，而它**不是九个模块那样的知识笔记**：
     整篇是围绕一家具名公司的招聘文档写的战术文档 —— 目标公司名、岗位名、
     逐字面试话术、自己承认没到的部分、"投递时附上这个"的动作计划都在里面。

     所以纳入方式不是"加一行文件名"，而是三层处理一起上：
       ① REDACT 抹掉公司名/产品名
       ② EXCLUDE_TITLE_PATTERNS 整节扔掉第 3 节（面试怎么说）、第 4 节（写成作品）
       ③ DROP_LINE_PATTERNS 行级丢掉「和我的连接」这类自述
     然后由 scanLeaks() 对着**产物**兜最后一道。 */
  M10: "M10-前沿理念地图.md",
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  /* 知识库整个不在的话，后面每个模块都会打一行「找不到…跳过」，
     然后产出一个空数组并覆盖写。与其让人从 10 行警告里自己拼出结论，
     不如在这里直接停 —— 这是 2026-09-15 那次路径打断的教训。 */
  if (!fs.existsSync(NOTES_DIR)) {
    console.error(`\n✗ 找不到知识库笔记目录：${NOTES_DIR}`);
    console.error("   知识库是这个仓库的**兄弟目录**，不在版本控制里。");
    console.error("   确认 career-knowledgebase 在 <仓库>/../ 下，或改 KB_ROOT。");
    process.exit(1);
  }

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
    const dia = cards.reduce((n, c) => n + (c.diagrams ? c.diagrams.length : 0), 0);
    console.log(
      `  ${id} · ${MODULE_TITLES[id]}：${cards.length} 张卡片` + (dia ? `，${dia} 张图` : "")
    );
  }
  guardDiagrams(modules);
  /* ⚠️ modules.json 原来**没有**骤降闸门，只有 questions.json 有。
     那是个疏漏：模块这边一样会「解析悄悄失效 → 覆盖写 → 数据没了」，
     而且它挂着的是云端学习进度（按 module_id 关联）。
     按卡片总数比，不按模块数 —— 模块数是 10 个写死的键，
     解析失效时它可能还是 10，而卡片会掉到 0。 */
  guardShrink("modules.json", modules.reduce((n, m) => n + m.cards.length, 0), (old) =>
    old.reduce((n, m) => n + (m.cards ? m.cards.length : 0), 0)
  );

  /* ⚠️ 脱敏闸门必须在**写任何文件之前**跑，而且要同时看两份产物。
     原来的顺序是「写 modules.json → 再解析题目 → 写 questions.json」，
     那样的话题库里发现泄漏时 modules.json 已经落盘了 —— 一次导入
     产出一半，另一半是上一版，两份对不上是更难查的状态。 */
  guardLeaks(modules, fs.existsSync(QUESTIONS_FILE) ? parseQuestions(readFile(QUESTIONS_FILE)) : []);

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
    /* ⚠️ 必须在覆盖写之前读旧产物 —— 迁移映射只能从它推，不能从当前文件推。
       差点犯的错：我原本用「当前文件里第 N 条」算 legacyId 来生成映射。
       但数据库里的旧 id 是**上一版文件**的顺序算出来的，中间加过题，
       两套顺序对不上。用当前顺序生成映射，等于把作答记录搬到别的题上 ——
       正是这次要修的那个 bug，只不过换成由迁移脚本来犯。
       正确的锚点是**题干文本**：旧产物里有 {id, question}，新的也有，按题干对。 */
    const oldQuestions = readOldQuestions();
    const questions = parseQuestions(readFile(QUESTIONS_FILE));
    guardShrink("questions.json", questions.length);
    fs.writeFileSync(
      path.join(OUT_DIR, "questions.json"),
      JSON.stringify(questions, null, 2) + "\n",
      "utf-8"
    );
    console.log(`  面试题：${questions.length} 条（仅 M1~M8 规整问答对，M9 外部题待补答案后再收）`);
    writeIdMigration(questions, oldQuestions);
  }

  reportReviewStatus();
}

/* 导入完成后的提示。
 *
 * 原来这里打的是三行「接下来必须人工 review」—— 而那条提示从写下来到现在
 * 一直没有任何东西记录它有没有被执行过（包括我自己跑的那几次，一次都没看）。
 * 现在改成指向真的会拦住 build 的那个机制。
 */
function reportReviewStatus() {
  console.log("\n✅ 导入完成。");
  console.log("   产物已经过脱敏三层过滤 + 词表扫描，但**机器只能查它认识的词**。");
  console.log("   接下来：");
  console.log("     npm run build          # 会列出具体哪几条内容变了、需要你看");
  console.log("     npm run content:review # 看完之后签章");
  console.log("   在签章之前 build 是红的 —— 这是故意的：");
  console.log("   内容一旦提交进公开仓库，git 历史里就永远有了。");
}

/* 脱敏第二道防线。词表和扫描逻辑在 leaks.mjs，那里写了为什么需要第二道。
 *
 * 这里只负责一件事：**扫出东西就拒绝写文件**。
 * 不是 warning —— warning 会被跳过，而这类内容一旦提交进公开仓库，
 * git 历史里就永远有了，删不掉。宁可让导入失败。
 */
function guardLeaks(modules, questions) {
  const hits = scanLeaks([
    { name: "modules.json", items: modulesToItems(modules) },
    { name: "questions.json", items: questionsToItems(questions) },
  ]);
  if (hits.length === 0) return;

  console.error(`\n✗ 拒绝写入：产物里扫到 ${hits.length} 处可能的隐私泄漏。`);
  printLeaks(hits);
  console.error("\n   怎么办（按优先级）：");
  console.error("   1. 改知识库原文 —— 把自评那句话挪到笔记的私人小节里");
  console.error("   2. 给那一节换个会被 EXCLUDE_TITLE_PATTERNS 排除的标题");
  console.error("   3. 确实是误报的话，改 leaks.mjs 的词表，并在那里写下理由");
  console.error("\n   ⚠️ 不要靠「反正 excerpt 会截断」或「反正解析到那儿就 break 了」——");
  console.error("      这两个都是已经查实的「靠运气挡住」，而运气会变。");
  process.exit(1);
}

/* M9 图源闸门。
 *
 * 和 guardShrink 是同一类闸门，防的也是同一个模式：**解析悄悄失效，脚本不报错**。
 * 这里盯的是一个很窄但很关键的事实 —— M9 是全部九个模块里**唯一**有 mermaid 的
 * （实测：M1~M8 加 M10 共 18 个代码块，mermaid 0 个），而那六张图是脑图页的
 * 唯一内容源。所以只要 M9 在、图却是 0，就一定是出了问题：
 * Obsidian 换了围栏写法、正则被改坏、或者有人把 diagrams 那段删了。
 *
 * ⚠️ 阈值写的是「至少 1 张」而不是「正好 6 张」：写死 6 会在我真的往 M9 加第七张图
 * 或拆掉一张时误拦，而那是正常的编辑动作。一个会误报的闸门会被学会忽略。
 * 从 6 掉到 1 这种"掉了但没掉光"的情形，靠下面打印的张数让人看见，不靠拦。
 */
function guardDiagrams(modules) {
  const m9 = modules.find((m) => m.id === "M9");
  if (!m9) return; // M9 文件不在（上面已经 warn 过），不是这道闸门的事
  const n = m9.cards.reduce((s, c) => s + (c.diagrams ? c.diagrams.length : 0), 0);
  if (n > 0) return;

  console.error("\n✗ 拒绝写入 modules.json：M9 一张 mermaid 图都没解析出来。");
  console.error("   M9 是唯一带 mermaid 的模块，那六张图是脑图页的唯一内容源。");
  console.error("   常见原因：围栏写法变了（```mermaid 后面跟了语言别名或空格）、");
  console.error("   extractDiagrams 的正则被改坏、或者 M9 文件本身被改过。");
  console.error("   不拦的话，脑图页会变成一个空页面，而且不报错。");
  process.exit(1);
}

/* 产出量骤降闸门。
 *
 * ⚠️ 这道闸门是被 CRLF 那个 bug 逼出来的，而它防的不是 CRLF ——
 * 是**「解析悄悄失效 → 覆盖写 → 数据没了」这个模式本身**。
 * 那次的原因是行尾，下次可能是 Obsidian 改了标题格式、可能是我改坏了正则。
 * 原因每次都不一样，症状每次都一样：条数掉到 0，脚本不报错，文件被清空。
 *
 * 判据用「和已有产物比」而不是「和一个写死的下限比」：
 * 写死的下限（比如 30）在题库真的只有 20 条时会误拦，而它本该允许。
 * 和上一次的产出比，才能区分"你删了几道题"和"解析炸了"。
 *
 * 阈值 50%：正常增删不会一次砍掉一半。真要大改就照提示删掉旧文件再跑。
 */
function guardShrink(name, count, countOld) {
  const prev = path.join(OUT_DIR, name);
  if (!fs.existsSync(prev)) return; // 首次生成，没有可比的
  let old = [];
  try {
    old = JSON.parse(fs.readFileSync(prev, "utf-8"));
  } catch {
    return; // 旧文件坏了就不拦，那是另一个问题
  }
  if (!Array.isArray(old) || old.length === 0) return;
  /* 默认按数组长度比（题库就是一条一项）。modules.json 是嵌套的，
     传一个数法进来 —— 那边要数的是卡片总数，不是模块数。 */
  const oldCount = countOld ? countOld(old) : old.length;
  if (oldCount === 0) return;
  if (count >= oldCount * 0.5) return;

  console.error(`\n✗ 拒绝写入 ${name}：条数从 ${oldCount} 掉到 ${count}（少了一半以上）。`);
  console.error("   这几乎总是解析失效，不是你真的删了那么多内容。");
  console.error("   常见原因：源文件行尾变了（CRLF/LF）、标题格式变了、正则被改坏。");
  console.error(`   确认就是要这么改的话：先删掉 src/data/${name} 再跑一次。`);
  console.error("\n   ⚠️ 不拦的话，后果是这些条目在云端的作答/进度记录全部变成孤儿 ——");
  console.error("      而且不报错，你会以为是自己没做过。");
  process.exit(1);
}

/* 一次性迁移：把 career_question_practice 里旧的位置型 id 换成内容型 id。
 *
 * ⚠️ 为什么产出 SQL 而不是在应用里自动改：
 * 这是**改数据**，而且不可逆。让它在某个页面加载时静默跑掉，
 * 万一映射有问题就没有回头路了。产出一个文件、由人看过再执行，
 * 代价是多一步，换来的是这一步可审计。
 *
 * ⚠️ **映射的锚点是题干文本，不是位置。**
 * 我第一版是拿「当前文件里第 N 条」算出旧 id 来配对的 —— 那是错的：
 * 数据库里的旧 id 是**上一版文件**的顺序算出来的，中间加过题，两套顺序对不上。
 * 用当前顺序生成映射，等于把作答记录搬到别的题上 ——
 * 正好是这次要修的那个 bug，只不过换成由迁移脚本来犯。
 * 旧产物 questions.json 里同时有 {旧 id, 题干}，新解析结果里有 {新 id, 题干}，
 * 按题干对才是对的。
 */
function readOldQuestions() {
  const p = path.join(OUT_DIR, "questions.json");
  if (!fs.existsSync(p)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIdMigration(questions, oldQuestions) {
  /* 只对「旧产物里是位置型 id」的行产出迁移。都已经是内容型了就没什么可迁的。 */
  const legacy = (oldQuestions || []).filter((q) => /^m\d+-q\d+$/.test(String(q.id || "")));
  const outDir = path.resolve(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "migrate-question-ids.sql");

  if (legacy.length === 0) {
    if (fs.existsSync(file)) {
      console.log("  迁移 SQL：旧产物已无位置型 id，保留已生成的文件不动");
    }
    return;
  }

  /* 按题干配对。⚠️ 用规范化后的题干当键 —— 旧产物是上一版脱敏词典跑出来的，
     公司名替换规则要是变过，原文会对不上，而规范化只去空白和尾问号，
     不受脱敏影响的部分仍能对上大多数。对不上的单独列出来，不静默丢。 */
  const newByNorm = new Map();
  for (const q of questions) newByNorm.set(questionId(q.question), q);

  const pairs = [];
  const orphans = [];
  for (const old of legacy) {
    const hit = newByNorm.get(questionId(old.question || ""));
    if (hit) pairs.push({ old, next: hit });
    else orphans.push(old);
  }

  const lines = [
    "-- 题目 id：位置型 → 内容型 的一次性迁移",
    "--",
    "-- 背景：旧 id 是 `m1-q7` 这种，语义由「这条问答在 面试题库.md 里的出现次序」",
    "-- 决定。往中间插一条新题，其后所有 id 平移，作答记录会静默挂到另一道题上。",
    "-- 新 id 从题干内容派生，插入/删除/重排都不影响。",
    "--",
    "-- 映射按**题干文本**配对，不是按位置——按位置配会把记录搬到别的题上。",
    "--",
    "-- 怎么用：在 Supabase SQL Editor 里整段执行。它只动你自己的行（RLS 生效）。",
    "-- ⚠️ 执行前扫一眼下面的注释行，确认「旧 id → 题干」看着对得上。这是改数据，不可逆。",
    "-- ⚠️ 只该执行一次。重复执行是安全的（第二次匹配不到旧 id，0 行受影响）。",
    "",
    "",
    "-- ════════ 第 1 步：先单独跑这一句，看看到底有没有东西要迁 ════════",
    "--",
    "-- 如果返回 0 行，说明你还没在 03 题库页标记过任何题 —— 那就**不用跑下面的迁移**，",
    "-- 直接关掉这个文件即可。新 id 已经在 questions.json 里了，从现在起标记的都是新 id。",
    "--",
    "select count(*) as 待迁移行数",
    "from career_question_practice",
    "where user_id = auth.uid() and question_id ~ '^m[0-9]+-q[0-9]+$';",
    "",
    "",
    "-- ════════ 第 2 步：确认上面 > 0 之后，再整段跑下面的 ════════",
    "",
    "begin;",
    "",
  ];

  for (const { old, next } of pairs) {
    const short = String(next.question).replace(/\n/g, " ");
    lines.push(`-- ${old.id} → [${next.module}] ${short.length > 44 ? short.slice(0, 44) + "…" : short}`);
    lines.push(
      `update career_question_practice set question_id = '${next.id}'` +
      ` where question_id = '${old.id}' and user_id = auth.uid();`
    );
  }

  if (orphans.length) {
    lines.push("");
    lines.push(`-- ⚠️ 下面 ${orphans.length} 条在新题库里找不到对应题干，**没有生成迁移语句**。`);
    lines.push("-- 多半是这些题被改写或删掉了。它们的作答记录会变成孤儿行。");
    lines.push("-- 先自己看一眼再决定删不删——别让脚本替你做这个决定。");
    for (const o of orphans) {
      lines.push(`--   ${o.id}  ${String(o.question || "").slice(0, 50)}`);
    }
  }

  lines.push("");
  lines.push("-- 迁移后还剩哪些旧格式的行：");
  lines.push(
    "select question_id, result, wrong_count from career_question_practice" +
    " where user_id = auth.uid() and question_id ~ '^m[0-9]+-q[0-9]+$';"
  );
  lines.push("");
  lines.push("commit;");
  lines.push("");

  fs.writeFileSync(file, lines.join("\n"), "utf-8");
  console.log(
    `  迁移 SQL：scripts/out/migrate-question-ids.sql（${pairs.length} 条映射` +
    (orphans.length ? `，${orphans.length} 条找不到对应题干、已单独列出` : "") + "）"
  );
}

/* ⚠️ 只在**直接运行**时执行，被 import 时不跑。
   没有这个守卫，测试一 import 这个模块就会真的重写 src/data/*.json ——
   一个"跑测试会改产物"的项目，测试就没人敢跑了。 */
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
