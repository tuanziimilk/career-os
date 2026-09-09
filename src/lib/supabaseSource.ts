// Supabase 数据源：真实数据，跨设备同步，需要登录后才能读到（RLS 强制）。
// 未登录时所有查询返回空数组——这不是前端判断出来的空，是数据库层面
// "这个请求没带有效身份，什么都不给"。
//
// 内容/状态分离（P3 决策落地于此）：career_learning_progress 没有 title 列，
// career_question_practice 没有题干/答案列——这是刻意的，不是遗漏。
// 模块标题、题干、答案属于"内容"，来自 src/data/modules.json / questions.json
// （由 Obsidian 笔记单向导入），数据库只存"状态"。这里的 getLearning/getQuestions
// 因此只返回状态半张脸，由调用方（页面层）拿内容数据去拼完整对象。
import { supabase, supabaseConfigured } from "./supabaseClient";
import type {
  ActivityDay,
  CapabilityRow,
  InterviewQuestion,
  JobRecord,
  LearningModule,
  DataSource,
  ModuleStatus,
  QuestionResult,
  Status,
  StatusEvent,
  WriteResult,
} from "./types";

interface JdRow {
  job_key: string;
  title: string | null;
  company: string | null;
  salary: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_months: number | null;
  salary_period: string | null;
  salary_source: string | null;
  tagline: string | null;
  url: string | null;
  site: string | null;
  intent: string | null;
  status: string | null;
  fail_reason: string | null;
  body: string | null;
  page_text: string | null;
  collected_at: string | null;
}

interface HistoryRow {
  job_key: string;
  status: string;
  at: string;
}

async function getUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** 读失败时把原因喊出来。
 *  读方法按契约返回数组，出错时只能返回 []——但"查询失败"和"你还没有数据"
 *  在界面上长得一模一样（都是空列表），这正是最难查的一类问题：
 *  少一条 GRANT 就会让整个工作台空着且不报错。所以至少在控制台留下证据。 */
function reportReadError(what: string, error: { message: string; code?: string } | null): void {
  if (!error) return;
  console.error(
    `[career-os] 读取 ${what} 失败（界面会显示为空，不是真的没数据）：` +
      `${error.code ? error.code + " " : ""}${error.message}
` +
      `如果是 42501 permission denied，说明 supabase/schema.sql 末尾那段 GRANT 没跑。`
  );
}

function ok(): WriteResult {
  return { ok: true };
}

function fail(reason: string): WriteResult {
  return { ok: false, reason };
}

/** 记一次"今天动过了"。故意不把它的失败往上抛——
 *  活动日志只喂总览页那个连续天数，为了它让"标记已懂"这个主操作报错不值得。 */
async function logActivity(kind: "learning" | "question"): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("career_log_activity", { kind });
}

const NO_LOGIN = fail("还没登录云端数据源——点右上角「切换数据源」发送登录链接。");

export const supabaseSource: DataSource = {
  kind: "supabase",
  label: "真实数据（云端）",

  async getJobs(): Promise<JobRecord[]> {
    if (!supabase) return [];
    const uid = await getUserId();
    if (!uid) return []; // 未登录：不查，直接返回空——RLS 也会挡住，这里是提前短路省一次请求

    const [{ data: jds, error: e1 }, { data: hist, error: e2 }] = await Promise.all([
      supabase.from("career_jds").select("*").order("collected_at", { ascending: false }),
      supabase.from("career_status_history").select("job_key, status, at").order("at"),
    ]);

    reportReadError("career_jds", e1);
    reportReadError("career_status_history", e2);

    const historyByKey = new Map<string, StatusEvent[]>();
    ((hist as HistoryRow[]) || []).forEach((h) => {
      const list = historyByKey.get(h.job_key) || [];
      list.push({ status: (h.status as Status) || "", at: h.at });
      historyByKey.set(h.job_key, list);
    });

    return ((jds as JdRow[]) || []).map((r) => ({
      key: r.job_key,
      title: r.title || "（无标题）",
      company: r.company || "—",
      salary: r.salary || "",
      // 只有 min/max 都有才算解析成功。一个有一个没有说明数据被改坏过，
      // 这时候当作"没有结构化薪资"，让界面回退去显示原文，不半信半疑地用。
      salaryParsed:
        r.salary_min != null && r.salary_max != null
          ? {
              min: r.salary_min,
              max: r.salary_max,
              months: r.salary_months ?? undefined,
              period: (r.salary_period as "month" | "day" | "year") || undefined,
            }
          : null,
      salarySource: r.salary_source || undefined,
      tagline: r.tagline || "",
      url: r.url || "",
      site: r.site || "",
      intent: (r.intent as JobRecord["intent"]) || "",
      status: (r.status as Status) || "",
      failReason: r.fail_reason || undefined,
      statusHistory: historyByKey.get(r.job_key) || [],
      ts: r.collected_at || new Date().toISOString(),
      body: r.body || undefined,
      pageText: r.page_text || undefined,
    }));
  },

  async getCapabilities(): Promise<CapabilityRow[]> {
    if (!supabase) return [];
    const uid = await getUserId();
    if (!uid) return [];
    const { data, error } = await supabase
      .from("career_profile")
      .select("capabilities")
      .eq("user_id", uid)
      .maybeSingle();
    reportReadError("career_profile", error);
    const caps = (data?.capabilities as Record<string, string>) || {};
    // ⚠️ 排序必须在这儿做：capabilities 存成 jsonb，Postgres 不保证键序
    //    （实测读回来 To C 产品🔴 排在第一个）。而这份列表的阅读顺序有意义——
    //    强项在前、短板在后。所以按 level 排，同级保持读到的顺序。
    const ORDER: Record<string, number> = { "🟢": 0, "🟡": 1, "🔴": 2, "": 3 };
    const rows: CapabilityRow[] = Object.entries(caps).map(([group, note]) => ({
      group,
      note,
      level: (note.match(/^(🟢|🟡|🔴)/)?.[1] as CapabilityRow["level"]) || "",
    }));
    return rows.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  },

  // 只返回"状态"，title 留空——由 Learning 页拿 modules.json 的内容拼完整对象。
  // 不再用 module_id 顶替 title：那是假装有数据，宁可留空让调用方看出这是半成品。
  async getLearning(): Promise<LearningModule[]> {
    if (!supabase) return [];
    const uid = await getUserId();
    if (!uid) return [];
    const { data, error } = await supabase
      .from("career_learning_progress")
      .select("module_id, status, note")
      .eq("user_id", uid)
      .order("module_id");
    reportReadError("career_learning_progress", error);
    return ((data as { module_id: string; status: string; note: string | null }[]) || []).map(
      (r) => ({
        id: r.module_id,
        title: "",
        status: r.status as LearningModule["status"],
        note: r.note || undefined,
      })
    );
  },

  // 同上：question/answer/module 留空，由 Practice 页拿 questions.json 拼完整对象。
  async getQuestions(): Promise<InterviewQuestion[]> {
    if (!supabase) return [];
    const uid = await getUserId();
    if (!uid) return [];
    const { data, error } = await supabase
      .from("career_question_practice")
      .select("question_id, result, wrong_count")
      .eq("user_id", uid);
    reportReadError("career_question_practice", error);
    return ((data as { question_id: string; result: string; wrong_count: number }[]) || []).map(
      (r) => ({
        id: r.question_id,
        module: "",
        question: "",
        answer: "",
        result: r.result as InterviewQuestion["result"],
        wrongCount: r.wrong_count,
      })
    );
  },

  async getActivityDays(): Promise<ActivityDay[]> {
    if (!supabase) return [];
    const uid = await getUserId();
    if (!uid) return [];
    const { data, error } = await supabase
      .from("career_activity")
      .select("day, learning_touches, question_touches")
      .eq("user_id", uid)
      .order("day", { ascending: false })
      .limit(400);
    // 表还没建（schema.sql 里的 career_activity 那段没跑）时返回空，
    // 界面会显示"还没有学习记录"——不去猜一个连续天数。
    if (error) {
      reportReadError("career_activity", error);
      return [];
    }
    return ((data as { day: string; learning_touches: number; question_touches: number }[]) || []).map(
      (r) => ({ day: r.day, learning: r.learning_touches, question: r.question_touches })
    );
  },

  // ---------------------------------------------------------------- 写方法

  async upsertJob(job): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;
    const { error } = await supabase.from("career_jds").upsert(
      {
        user_id: uid,
        job_key: job.key,
        title: job.title,
        company: job.company,
        salary: job.salary,
        // 结构化薪资由调用方（JobEditModal）解析后传进来。
        // 解析不出来就全推 null——数据库的 check 约束会拒绝荒唐值，
        // 拿原文里的任意数字凑数会让整条写入失败。
        salary_min: job.salaryParsed?.min ?? null,
        salary_max: job.salaryParsed?.max ?? null,
        salary_months: job.salaryParsed?.months ?? null,
        salary_period: job.salaryParsed?.period ?? null,
        salary_source: job.salarySource ?? null,
        tagline: job.tagline,
        url: job.url,
        site: job.site || "手动录入",
        intent: job.intent,
        status: job.status,
        fail_reason: job.failReason,
        body: job.body,
        page_text: job.pageText,
        collected_at: job.ts || new Date().toISOString(),
      },
      { onConflict: "user_id,job_key" }
    );
    return error ? fail(error.message) : ok();
  },

  // 只在状态真的变了时才应该被调用——这条规则由调用方（页面层/Job编辑框）负责，
  // 数据源本身不重复判断，避免和 extension 侧 pushStatus() 的判重逻辑产生两套标准。
  async appendStatus(jobKey, status, at): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;
    const atTs = at || new Date().toISOString();
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("career_status_history").insert({
        user_id: uid,
        job_key: jobKey,
        status,
        at: atTs,
      }),
      supabase
        .from("career_jds")
        .update({ status })
        .eq("user_id", uid)
        .eq("job_key", jobKey),
    ]);
    if (e1) return fail(e1.message);
    if (e2) return fail(e2.message);
    return ok();
  },

  /* 删除。顺序刻意是「先写墓碑、再删记录」：
     如果先删记录、写墓碑时断网，云端记录没了但墓碑也没有，
     插件下次同步就会把它重新 upsert 回来——记录复活且没人知道。
     反过来（墓碑写成功、删除失败）只是留下一条待删记录，
     插件同步时会读到墓碑并清掉本地，下次工作台刷新也会重试删除。
     两种失败方向里，选择更容易恢复的那一种。 */
  async deleteJob(jobKey): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;

    const { error: eTomb } = await supabase
      .from("career_deleted_jds")
      .upsert(
        { user_id: uid, job_key: jobKey, deleted_at: new Date().toISOString(), deleted_by: "工作台" },
        { onConflict: "user_id,job_key" }
      );
    if (eTomb) return fail("写删除记录失败，没有执行删除：" + eTomb.message);

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("career_status_history").delete().eq("user_id", uid).eq("job_key", jobKey),
      supabase.from("career_jds").delete().eq("user_id", uid).eq("job_key", jobKey),
    ]);
    if (e1) return fail("状态历史删除失败：" + e1.message);
    if (e2) return fail(e2.message);
    return ok();
  },

  async setFailReason(jobKey, reason): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;
    const { error } = await supabase
      .from("career_jds")
      .update({ fail_reason: reason })
      .eq("user_id", uid)
      .eq("job_key", jobKey);
    return error ? fail(error.message) : ok();
  },

  async setLearningStatus(moduleId, status: ModuleStatus): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;
    const { error } = await supabase
      .from("career_learning_progress")
      .upsert(
        { user_id: uid, module_id: moduleId, status },
        { onConflict: "user_id,module_id" }
      );
    if (error) return fail(error.message);
    await logActivity("learning");
    return ok();
  },

  async setQuestionResult(
    questionId,
    result: QuestionResult,
    wrongCount?: number
  ): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;
    const patch: Record<string, unknown> = {
      user_id: uid,
      question_id: questionId,
      result,
      last_practiced_at: new Date().toISOString(),
    };
    if (wrongCount != null) patch.wrong_count = wrongCount;
    const { error } = await supabase
      .from("career_question_practice")
      .upsert(patch, { onConflict: "user_id,question_id" });
    if (error) return fail(error.message);
    await logActivity("question");
    return ok();
  },

  async updateCapabilities(caps: CapabilityRow[]): Promise<WriteResult> {
    if (!supabase) return fail("Supabase 未配置。");
    const uid = await getUserId();
    if (!uid) return NO_LOGIN;
    const obj: Record<string, string> = {};
    caps.forEach((c) => (obj[c.group] = c.note));
    const { error } = await supabase
      .from("career_profile")
      .upsert({ user_id: uid, capabilities: obj }, { onConflict: "user_id" });
    return error ? fail(error.message) : ok();
  },
};

export { supabaseConfigured };
