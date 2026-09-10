// Demo 数据。这是公开部署版默认加载的数据源。
//
// ⚠️ 全部虚构，公司名不能和任何真实公司同名或谐音——
// 用真实公司名会被误读成"我投过这些公司"，暴露真实投递意图。
// 数字要合理：不做"投5进5"这种夸张漏斗，也不做全绿全通过——
// 一个真实的漏斗应该有沉默、有挂掉、有归因缺失。
import type {
  ActivityDay,
  CapabilityRow,
  InterviewQuestion,
  JobRecord,
  LearningModule,
  DataSource,
  WriteResult,
} from "./types";
import { unsupportedWrite } from "./types";

/** 演示用的假简历。刻意在结尾注明，避免被误当成真的。 */
const DEMO_RESUME = `彭XX ｜ AI 产品经理 ｜ 上海 ｜ 5 年经验

— 核心能力 —
AI 产品 0→1 落地：独立完成需求定义、Skill 拆解、工作流编排到上线全流程
知识库 / RAG 体系：与运营、算法协作沉淀业务数据资产，持续提升回答准确率
效果评估：定义评测维度与量化指标，搭建自动化评测与 badcase 优化闭环
跨团队协作：把业务方的模糊诉求转译为可执行需求，自主判断优先级

— 经历 —
2023.06–至今  某出行平台 · AI 产品经理
  主导榜单业务 AI 中后台从 0 到 1，覆盖知识库、工作流、Skill 设计
  在保障效果的同时把 token 成本降低约 40%，响应时间缩短一半

2021.03–2023.05  某电商平台 · 产品经理（增长）
  负责站内搜索与推荐的策略迭代，主导 SEO 体系搭建

— 技能 —
Prompt 工程 / SQL / PRD / 数据分析 / 英语可工作沟通

（以上为演示数据，不是真实简历）`;
import { parseSalary } from "./salary";

const d = (daysAgo: number, hh = 11, mm = 30): string => {
  const t = new Date(Date.now() - daysAgo * 86400000);
  const iso = t.toISOString().slice(0, 10);
  return `${iso} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
};

const DEMO_JOBS_RAW: JobRecord[] = [
  {
    key: "demo-1",
    title: "AI 产品经理",
    company: "星海科技",
    salary: "28-42K·14薪",
    tagline: "上海 · 3-5年 · 本科",
    body: `岗位职责：
1. 负责 AI 产品从 0 到 1 的规划与落地，撰写 PRD 并推动跨部门协同上线；
2. 搭建 RAG 检索增强链路，负责知识库召回与重排的效果优化；
3. 建立效果评测体系，定义准确率与召回率指标，做 badcase 分桶分析；
4. 用 SQL 完成数据分析，搭建转化漏斗看板，用数据驱动迭代。
任职要求：
1. 本科及以上学历，3-5年产品经验；
2. 熟悉大模型与 prompt 工程，了解 Agent 与工具调用；
3. 有出海或跨境业务经验加分，英语可作为工作语言。`,
    url: "#",
    site: "demo",
    intent: "🔥",
    status: "offer",
    statusHistory: [
      { status: "", at: d(38) },
      { status: "想投", at: d(37) },
      { status: "已投", at: d(35) },
      { status: "进面", at: d(29) },
      { status: "复面", at: d(20) },
      { status: "offer", at: d(2) },
    ],
    ts: d(38),
  },
  {
    key: "demo-2",
    title: "AI Agent 产品经理",
    company: "云图智能",
    salary: "25-38K",
    tagline: "上海 · 3-5年 · 本科",
    body: `岗位职责：
1. 负责 Agent 产品的能力设计与工作流编排，落地带护栏的工具调用；
2. 设计多轮对话交互，负责会话状态管理与异常兜底策略；
3. 与算法团队协同，定义评测指标并持续优化效果。
任职要求：
1. 本科及以上，3年以上产品经验；
2. 深入理解 LLM 原理与 function call 机制；
3. 有 workflow 编排平台（coze / dify 类）实践经验优先。`,
    url: "#",
    site: "demo",
    intent: "🔥",
    status: "已挂",
    failReason: "一面挂-项目深挖",
    statusHistory: [
      { status: "", at: d(33) },
      { status: "已投", at: d(31) },
      { status: "进面", at: d(26) },
      { status: "已挂", at: d(23) },
    ],
    ts: d(33),
  },
  {
    key: "demo-3",
    title: "大模型应用产品经理",
    company: "远航数据",
    salary: "22-35K",
    tagline: "杭州 · 3-5年 · 本科",
    url: "#",
    site: "demo",
    intent: "🔥",
    status: "已挂",
    failReason: "一面挂-表达散",
    statusHistory: [
      { status: "", at: d(29) },
      { status: "已投", at: d(27) },
      { status: "进面", at: d(22) },
      { status: "已挂", at: d(19) },
    ],
    ts: d(29),
  },
  {
    key: "demo-4",
    title: "AI 智能客服产品经理",
    company: "启明金融科技",
    salary: "30-45K·15薪",
    tagline: "上海 · 3-5年 · 本科",
    body: `岗位职责：
1. 负责智能客服产品的多轮对话能力设计，撰写需求文档推动落地；
2. 搭建知识库与语义检索链路，优化召回准确率；
3. 建立客服场景的效果评估体系，做 badcase 分析与指标定义。
任职要求：
1. 本科及以上学历，3-5年经验；
2. 有金融、银行或保险行业产品经验者优先；
3. 熟悉大模型应用，有对话式产品从 0 到 1 经验。`,
    url: "#",
    site: "demo",
    intent: "🔥",
    status: "已投",
    statusHistory: [
      { status: "", at: d(24) },
      { status: "已投", at: d(19) },
    ],
    ts: d(24), // 距今 19 天已投、无后续 → 会被判定为沉默
  },
  {
    key: "demo-5",
    title: "AI 产品运营",
    company: "拾光互娱",
    salary: "20-30K",
    tagline: "上海 · 1-3年 · 本科",
    url: "#",
    site: "demo",
    intent: "👀",
    status: "已投",
    statusHistory: [
      { status: "", at: d(18) },
      { status: "已投", at: d(15) },
    ],
    ts: d(18), // 也沉默，验证多条沉默场景
  },
  {
    key: "demo-6",
    title: "Agent 产品负责人",
    company: "行远智造",
    salary: "35-55K",
    tagline: "深圳 · 5-8年 · 本科",
    body: `岗位职责：
1. 作为 Agent 产品负责人，规划自主智能体的产品路线与技术方案；
2. 主导多智能体协同架构设计，推动 MCP 与工具生态建设；
3. 建立 Agent 效果评测框架，定义任务成功率等核心指标。
任职要求：
1. 本科及以上，5年以上产品经验，其中 2 年以上 AI 方向；
2. 精通 Agent、workflow 编排与 prompt 工程；
3. 有跨部门推动大型项目落地的经验。`,
    url: "#",
    site: "demo",
    intent: "❌",
    status: "已拒",
    failReason: "薪资谈崩",
    statusHistory: [
      { status: "", at: d(35) },
      { status: "已投", at: d(33) },
      { status: "进面", at: d(28) },
      { status: "已拒", at: d(25) },
    ],
    ts: d(35),
  },
  {
    key: "demo-7",
    title: "增长产品经理（AI方向）",
    company: "普惠优选",
    salary: "18-28K",
    tagline: "上海 · 3-5年 · 大专",
    url: "#",
    site: "demo",
    intent: "❌",
    status: "已挂",
    // 归因故意留空——demo 也要体现"不是每条都能归因"的真实情况
    statusHistory: [
      { status: "", at: d(14) },
      { status: "已投", at: d(12) },
      { status: "已挂", at: d(9) },
    ],
    ts: d(14),
  },
  {
    key: "demo-8",
    title: "AI 产品经理（出海方向）",
    company: "跨境云枢",
    salary: "26-40K",
    tagline: "上海 · 3-5年 · 本科",
    body: `岗位职责：
1. 负责海外市场的增长产品设计，通过 SEO 与内容分发提升自然流量；
2. 搭建 AI 搜索可见性（GEO）监测体系，做数据分析与看板；
3. 与海外团队协同推动本地化落地。
任职要求：
1. 本科及以上，3-5年增长或 SEO 相关经验；
2. 英语可作为工作语言，有出海经验；
3. 熟悉 SQL 与埋点分析。`,
    url: "#",
    site: "demo",
    intent: "🔥",
    status: "已投",
    statusHistory: [
      { status: "", at: d(6) },
      { status: "想投", at: d(5) },
      { status: "已投", at: d(4) },
    ],
    ts: d(6),
  },
  {
    key: "demo-9",
    title: "对话式 AI 产品经理",
    company: "语枢科技",
    salary: "24-36K",
    tagline: "上海 · 3-5年 · 本科",
    url: "#",
    site: "demo",
    intent: "👀",
    status: "",
    statusHistory: [{ status: "", at: d(3) }],
    ts: d(3),
  },
  {
    key: "demo-10",
    title: "AI 产品经理",
    company: "青藤数科",
    salary: "20-32K",
    tagline: "南京 · 1-3年 · 本科",
    url: "#",
    site: "demo",
    intent: "",
    status: "",
    statusHistory: [{ status: "", at: d(1) }],
    ts: d(1),
  },
];

/* 结构化薪资不手写十份，用真实解析器在加载时算出来。
 * 两个好处：demo 数据永远和 lib/salary.js 的行为一致（手写的会漂移），
 * 而且每次打开演示看板都等于跑了一遍解析器。 */
const DEMO_JOBS: JobRecord[] = DEMO_JOBS_RAW.map((j) => {
  const p = parseSalary(j.salary);
  return {
    ...j,
    salaryParsed:
      p.parsed && p.min != null && p.max != null
        ? { min: p.min, max: p.max, months: p.months, period: p.period }
        : null,
    salarySource: j.salary ? "详情面板" : undefined,
  };
});

const DEMO_CAPABILITIES: CapabilityRow[] = [
  // ⚠️ 这 15 个组是按「简历正文-AI产品经理版.md」(2026-09-08) 重定的，
  //    不是随手编的演示数据。技能词典 src/data/skills.json 的 group 字段
  //    必须和这里的组名逐字一致——挂不上的技能会落到"不知道"而不是"强项"。
  //    云端 career_profile.capabilities 也要用同一批组名。
  { group: "产品基本功", note: "🟢 内部后台系统 V2.1 产品需求方：PRD + 高保真原型 + 字段级规格 + 验收标准", level: "🟢" },
  { group: "一人全栈 0→1", note: "🟢 部门级 AI 系统独立交付：5 业务线 / 36 功能页 / 7.3 万行 / Docker 蓝绿部署", level: "🟢" },
  { group: "AI 落地护栏", note: "🟢 SQL 安全审查层（仅单条 SELECT / 拒 DDL / 只读账号）+ 人工抽检卡点 + 标杆验证后放量", level: "🟢" },
  { group: "评测 / 质量", note: "🟢 XX% 基线对标 + badcase 分桶 + CTR 五维度诊断标准流程", level: "🟢" },
  { group: "数据能力", note: "🟢 自然语言取数产品化 / SQL / 漏斗 / Metabase 多源打通", level: "🟢" },
  { group: "SEO / GEO / 内容增长", note: "🟢 CTR 诊断、meta 收录、内链、关键词搜索量、语义相关性评估", level: "🟢" },
  { group: "出海 / 国际化", note: "🟢 跨境平台多国放量（US/UK/DE/FR）+ 西班牙语专八", level: "🟢" },
  { group: "工程实现", note: "🟢 Python/FastAPI/React 19/Node/MySQL/Docker，能自己把方案跑起来", level: "🟢" },
  { group: "工程沟通", note: "🟢 跨部门推动 + 能与研发在方案层同层对话", level: "🟢" },
  { group: "RAG / 检索", note: "🟡 做过检索侧（Embedding 语义相似度服务），缺生成侧", level: "🟡" },
  { group: "Agent / 工作流", note: "🟡 n8n/Dify 工作流 + 带护栏的工具调用，非自主 Agent", level: "🟡" },
  { group: "模型技术原理", note: "🟡 概念级；做过 AI Provider 抽象层与模型切换/成本判断", level: "🟡" },
  { group: "对话式产品", note: "🔴 没做过多轮对话产品", level: "🔴" },
  { group: "To C 产品", note: "🔴 做的是内部工具；To C 只有 TikTok 7W 粉的内容增长", level: "🔴" },
  { group: "行业·金融", note: "🔴 无", level: "🔴" },
];

const DEMO_LEARNING: LearningModule[] = [
  { id: "M1", title: "RAG", status: "能空手讲" },
  { id: "M2", title: "Agent", status: "能空手讲" },
  { id: "M3", title: "Eval", status: "已懂" },
  { id: "M4", title: "产品方法论", status: "已懂" },
  { id: "M5", title: "大模型八股", status: "已懂" },
  { id: "M6", title: "AI-SEO-GEO", status: "已懂" },
  { id: "M7", title: "数据分析", status: "已懂" },
  { id: "M8", title: "AI产品落地能力", status: "在读" },
  { id: "M9", title: "Agent系统脑图", status: "在读" },
];

// ⚠️ id 必须对应 src/data/questions.json 里真实存在的题目 id，
// 不能是随手编的占位符——之前这里用 "q1"/"q2"/"q3"，和导入脚本生成的
// "m2-q6" 这类真实 id 对不上，导致 Practice 页统计出"会 2/39"却一条题目
// 都对不上号的孤儿记录（P3 联调时发现的真实 bug）。
const DEMO_QUESTIONS: InterviewQuestion[] = [
  {
    id: "m2-q6",
    module: "M2",
    question: "Agent vs 工作流？",
    answer: "工作流每步人定死、可预测；Agent 模型自主决定、更灵活但需护栏。流程固定用工作流，需临场判断才上 Agent。",
    result: "会",
    wrongCount: 0,
  },
  {
    id: "m8-q32",
    module: "M8",
    question: "调用失败/参数缺失怎么办？",
    answer: "区分可重试（超时/429/5xx）与不可重试（400/401），分别处理。",
    result: "模糊",
    wrongCount: 1,
  },
  {
    id: "m3-q10",
    module: "M3",
    question: "怎么评一个 AI 功能？",
    answer: "建标杆集→定指标→规则/LLM-judge/人工打分→比基线→灰度+监控。",
    result: "会",
    wrongCount: 0,
  },
];

async function delay<T>(v: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(v), ms));
}

// 演示用的连续天数：今天往前连着 5 天，再隔一天有一次。
// 写成相对今天而不是固定日期，否则 demo 看板过几天就显示"连续 0 天"。
function demoActivityDays(): ActivityDay[] {
  const out: ActivityDay[] = [];
  const key = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
  };
  [0, 1, 2, 3, 4].forEach((n) => out.push({ day: key(n), learning: 1, question: n % 2 }));
  out.push({ day: key(6), learning: 0, question: 3 });
  return out;
}

async function noWrite(): Promise<WriteResult> {
  return delay(unsupportedWrite("demo"), 0);
}

export const demoSource: DataSource = {
  kind: "demo",
  label: "演示数据",
  getJobs: () => delay(DEMO_JOBS),
  getCapabilities: () => delay(DEMO_CAPABILITIES),
  getLearning: () => delay(DEMO_LEARNING),
  getQuestions: () => delay(DEMO_QUESTIONS),
  getActivityDays: () => delay(demoActivityDays()),
  // demo 数据没有归属者，写了也没地方存——统一走这个兜底，
  // 页面层拿到 { ok:false, reason } 后应直接展示 reason，不是静默忽略。
  upsertJob: noWrite,
  appendStatus: noWrite,
  deleteJob: noWrite,
  setFailReason: noWrite,
  setLearningStatus: noWrite,
  setQuestionResult: noWrite,
  /* demo 模式给一份**假**简历：这一页空着的话看不出它长什么样，
   * 而 demo 数据正好是给截图和演示用的（真数字不进 demo）。 */
  getResume: () => delay({ text: DEMO_RESUME, updatedAt: new Date().toISOString() }, 120),
  setResume: () => delay(unsupportedWrite("demo"), 0),
  updateCapabilities: noWrite,
};
