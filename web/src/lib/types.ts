// 数据契约。三个数据源（demo / 本地文件 / Supabase）都产出这套类型，
// 渲染层只认这套类型，不关心数据从哪来——这是"整合"真正的核心，
// 不是把三个界面塞进一个应用，而是让它们遵守同一份契约。

export type Intent = "" | "🔥" | "👀" | "❌";

export type Status = "" | "想投" | "已投" | "进面" | "复面" | "offer" | "已挂" | "已拒";

export interface StatusEvent {
  status: Status;
  at: string; // ISO-ish "YYYY-MM-DD HH:mm:ss"
}

/** 结构化薪资。由扩展在采集时解析（jd-insight/extension/lib/salary.js），
 *  或工作台手工录入时解析。解析不出来就是 null——不猜。
 *
 *  刻意不含年薪：annual = min * (months ?? 12) 是纯函数，存两份必然漂移。
 *  需要时用 annualRange() 算。 */
export interface SalaryParsed {
  min: number; // 月薪下限（元）
  max: number; // 月薪上限（元）
  months?: number; // 13薪/15薪。没写就是 undefined，不默认成 12
  period?: "month" | "day" | "year"; // 原始口径，min/max 已折算成月薪
}

export interface JobRecord {
  key: string;
  title: string;
  company: string;
  /** 薪资原文，永远保留——"面议"这种解析不出来的东西只有原文说得清 */
  salary: string;
  salaryParsed?: SalaryParsed | null;
  /** 这个数从哪来的："详情面板" / "页面标题" / "meta 标签" / "手填" */
  salarySource?: string;
  tagline: string;
  url: string;
  site: string;
  intent: Intent;
  status: Status;
  failReason?: string;
  statusHistory: StatusEvent[];
  ts: string; // 采集时刻
  body?: string; // JD 正文（career_jds.body 已存，此前类型和 supabaseSource 都没读取，属数据断层）
  pageText?: string; // 整页兜底文本（career_jds.page_text）
}

/** 简历正文 + 它的元信息。
 *  ⚠️ 只存一份纯文本，不存原始文件。理由：
 *    - 匹配分析（match.ts）和扩展的「简历诊断」用的都是文本，存文件没人读
 *    - 原始 PDF/Word 里有姓名电话，进了数据库就多一处要操心的地方
 *  所以解析在浏览器里做完，只把文本传上去。 */
export interface ResumeRecord {
  text: string;
  updatedAt: string;
}

export type CapabilityLevel = "🟢" | "🟡" | "🔴" | "";

export interface CapabilityRow {
  group: string;
  note: string; // 例如 "🟢 一人 0→1 全栈交付"
  level: CapabilityLevel;
}

export type ModuleStatus = "未读" | "在读" | "已懂" | "能空手讲";

export interface LearningModule {
  id: string; // "M1".."M9"
  title: string;
  status: ModuleStatus;
  note?: string;
}

export type QuestionResult = "未测" | "会" | "不会" | "模糊";

export interface InterviewQuestion {
  id: string;
  module: string;
  question: string;
  answer: string;
  result: QuestionResult;
  wrongCount: number;
}

/** 某一天有没有学习/刷题动作。来自 career_activity 表——
 *  进度表每行只有一个 updated_at（最后一次改动），从那里算不出连续天数，
 *  所以按天单独记一行。day 是本地日期 "YYYY-MM-DD"。 */
export interface ActivityDay {
  day: string;
  learning: number;
  question: number;
}

/** 写操作统一返回这个：明确说清"到底有没有真的写成功"，
 *  而不是让调用方去猜返回值是 undefined 还是抛了异常。
 *  ok=false 时 reason 必须是人话（"当前数据源不支持写入"之类），
 *  不是把 Error.message 直接糊给用户看。 */
export interface WriteResult {
  ok: boolean;
  reason?: string;
  /** 写失败是因为**云端那一行在你读到它之后被改过**（另一台设备、另一个标签页、
   *  或者扩展那边）。和其他失败要分开，因为处理方式不一样：
   *  别的失败是重试，这个是**先看看别人改成了什么**，否则重试就是覆盖掉对方。
   *
   *  ⚠️ 只在"这一端读过这一行"的前提下能检测到。没读过就没有可比的版本号，
   *  那种情况退回原来的行为（最后写的赢）—— 见 supabaseSource 的 rowVersions 注释。 */
  conflict?: true;
}

/** 数据源必须提供的统一接口——三种实现互换，渲染层无感。
 *
 * 写方法全部可选（demo/local 源不实现，返回值走 unsupportedWrite 兜底），
 * 只有 supabaseSource 真正落地——因为写入需要一个能确权到"谁"的地方，
 * demo 数据没有归属者，local 文件源没有并发写保护，勉强做了也不安全。
 */
export interface DataSource {
  kind: "demo" | "local" | "supabase";
  label: string;
  getJobs(): Promise<JobRecord[]>;
  getCapabilities(): Promise<CapabilityRow[]>;
  getLearning(): Promise<LearningModule[]>;
  getQuestions(): Promise<InterviewQuestion[]>;
  /** 有活动的日期（用于连续学习天数）。数据源拿不到就返回空数组，
   *  由调用方显示"还没有记录"，不要凭进度表的 updated_at 硬凑一个数字。 */
  getActivityDays?(): Promise<ActivityDay[]>;

  /** 新增或更新一条投递记录（按 key 幂等） */
  upsertJob?(job: Partial<JobRecord> & { key: string }): Promise<WriteResult>;
  /** 追加一次状态变更，带时间戳——只在状态真的变了时候才应该调用它 */
  appendStatus?(jobKey: string, status: Status, at?: string): Promise<WriteResult>;
  /** 删掉一条投递记录。
   *  ⚠️ 实现必须同时写一条云端删除墓碑（career_deleted_jds）——
   *  否则插件下次同步会把这条重新 upsert 回来，记录复活。 */
  deleteJob?(jobKey: string): Promise<WriteResult>;
  /** 标注/修改挂掉原因 */
  setFailReason?(jobKey: string, reason: string): Promise<WriteResult>;
  /** 学习模块状态：未读/在读/已懂/能空手讲 */
  setLearningStatus?(moduleId: string, status: ModuleStatus): Promise<WriteResult>;
  /** 刷题结果：会/不会/模糊。不会/模糊时上层负责把 wrongCount 一并递增 */
  setQuestionResult?(
    questionId: string,
    result: QuestionResult,
    wrongCount?: number
  ): Promise<WriteResult>;
  /** 覆盖式更新能力自评 */
  updateCapabilities?(caps: CapabilityRow[]): Promise<WriteResult>;

  /** 读简历正文。没有就返回 null（不是空串——"没存过"和"存了个空的"要能分开）。 */
  getResume?(): Promise<ResumeRecord | null>;
  /** 覆盖式保存简历正文。传空串等于清空。 */
  setResume?(text: string): Promise<WriteResult>;
}

/** demo/local 源的写方法统一走这个兜底，文案在各处保持一致 */
export function unsupportedWrite(kind: DataSource["kind"]): WriteResult {
  return {
    ok: false,
    reason:
      kind === "demo"
        ? "当前是演示数据，不支持写入——登录云端数据源后再试。"
        : "本地文件数据源是只读的，不支持写入——登录云端数据源后再试。",
  };
}
