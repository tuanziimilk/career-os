/* JD 匹配分析。
 *
 * 三条硬规则，直接来自这个项目已有的原则：
 *
 * 1. **每一条命中必须带 JD 原文出处**。
 *    找不到能指回原文的句子就不算命中——"结论要能被验证"的落地。
 *    没有出处的分数是无法反驳的分数，那种分数不如不给。
 *
 * 2. **JD 正文没抓到就不给分**，返回 { ok:false, reason }。
 *    列表页采集的记录很多只有标题没正文，这时候算出来的任何分数都是错的。
 *    宁可明确说"分析不了"，也不要给一个 0 分让人以为"这岗位不匹配"。
 *
 * 3. **硬性门槛不折进分数**。学历不符不是"扣 8 分"，是一道闸门。
 *    把它折进百分比会让"85 分但学历不符"看起来比"70 分且完全符合"更好，
 *    而实际投递结果完全相反。
 *
 * 分数只有一个：加权技能覆盖率。刻意不做
 * EXPERIENCE / SKILLS / INDUSTRY / GROWTH 那种四维雷达——
 * 后两维我没有任何可靠数据能算，编出来的维度比没有维度更糟。
 */
import type { CapabilityLevel, CapabilityRow, JobRecord } from "./types";
import skillsData from "../data/skills.json";

interface SkillDef {
  id: string;
  label: string;
  group: string;
  weight: number;
  patterns: string[];
}
interface GateDef {
  id: string;
  label: string;
  kind: string;
  patterns: string[];
}
/* ⚠️ SKILLS 从内部常量改成导出，是给 07 校准台用的。
   那一页要做两件事：把 15 个能力组名**从词典派生**（而不是让人手填 —— 词典
   要求 capabilities 的组名和这里的 group 逐字一致，手填一个错字就静默少算一整组），
   以及把 26 项的权重/patterns 摊开显示。
   导出只读引用，不给它可写入口 —— 词典仍然只能改 JSON 源码。 */
export const SKILLS = (skillsData as { skills: SkillDef[] }).skills;
const GATES = (skillsData as { gates: GateDef[] }).gates;

/** 词典的元信息，给校准台显示「适用方向」和「改过什么、为什么」 */
export const DICT_META = {
  domainLabel:
    (skillsData as { domain?: { label?: string } }).domain?.label || "（未声明）",
  calibration: (skillsData as { calibration?: string[] }).calibration || [],
};

/* 正文门槛。**这两个数和 jd-insight/extension/lib/gap.js 必须一致**
   （那边是同一套判定的移植版）。
   120：低于这个长度不可能包含一份完整的岗位要求，硬算出来的覆盖率只会反映
   "我们没抓到内容"而不是"这岗位不匹配"。真实详情页正文 400~1200 字。
   200：退回整页文本时门槛要更高，因为 pageText 里混着导航和推荐位。 */
const MIN_BODY = 120;
const MIN_PAGETEXT = 200;

/** 取能用来分析的正文；取不到返回 null，让调用方决定是拒答还是跳过 */
function usableText(job: JobRecord): string | null {
  const body = (job.body || "").trim();
  if (body.length >= MIN_BODY) return body;
  const page = (job.pageText || "").trim();
  if (page.length >= MIN_PAGETEXT) return page;
  return null;
}

export interface SkillAudit {
  /** 命中了几条 JD */
  hitCount: number;
  /** 分母：有正文、能分析的 JD 条数（不是全部 JD） */
  analyzable: number;
  /** 真正命中过的 pattern —— 用来区分「验证过的词」和「还只是猜的词」 */
  matchedPatterns: string[];
  /** 命中的原句，最多 3 条 */
  evidence: { company: string; sentence: string }[];
}

/**
 * 拿真实采集的 JD 给某一项技能做体检。
 *
 * ⚠️ 刻意复用 `sentences()` / `hits()` / `usableText` 这套已有判定，
 * 不另写一份匹配逻辑 —— 体检的意义就是"显示线上真实行为"，
 * 一旦另写一套，它显示的就是另一个算法的行为，那比不显示更误导。
 */
export function auditSkill(skillId: string, jobs: JobRecord[]): SkillAudit {
  const sk = SKILLS.find((s) => s.id === skillId);
  const out: SkillAudit = { hitCount: 0, analyzable: 0, matchedPatterns: [], evidence: [] };
  if (!sk) return out;
  const matched = new Set<string>();

  for (const job of jobs) {
    const text = usableText(job);
    if (!text) continue; // 没正文的不算进分母，和 analyzeMatch 的口径一致
    out.analyzable += 1;

    let best = -Infinity;
    let sentence = "";
    for (const p of sk.patterns) {
      const sents = sentences(text);
      sents.forEach((x, i) => {
        if (!hits(x, p)) return;
        matched.add(p);
        const sc = evidenceScore(x, sents.length > 1 ? i / (sents.length - 1) : 1);
        if (sc > best) {
          best = sc;
          sentence = x.slice(0, 140);
        }
      });
    }
    if (sentence) {
      out.hitCount += 1;
      if (out.evidence.length < 3) {
        out.evidence.push({ company: job.company || "—", sentence });
      }
    }
  }
  out.matchedPatterns = [...matched];
  return out;
}

/** 我的水平 → 覆盖权重。未评估是 null，不是 0——"没自评过"和"不会"是两件事。 */
const LEVEL_SCORE: Record<CapabilityLevel, number | null> = {
  "🟢": 1,
  "🟡": 0.5,
  "🔴": 0,
  "": null,
};

export interface SkillHit {
  id: string;
  label: string;
  group: string;
  weight: number;
  /** JD 里命中的那句原文。这是这条结论的全部依据 */
  evidence: string;
  /** 命中的关键词，用来在原文里高亮 */
  matched: string;
  /** 我在这个能力组的自评。null = 这个能力组不在我的自评里 */
  level: CapabilityLevel | null;
  /** 我的水平折算的覆盖分，null = 未评估 */
  score: number | null;
}

export interface Gate {
  id: string;
  label: string;
  /** JD 的要求原文 */
  required: string;
  evidence: string;
}

export interface MatchResult {
  ok: true;
  /** 加权覆盖率 0~100。只统计「有自评」的命中项。
   *  null = 命中的能力组一个都没自评过，算不出来——
   *  这时候绝不能返回 0，那看起来像"完全不匹配"，而实际是"不知道"。 */
  coverage: number | null;
  /** 参与计算的权重总和 / 全部命中权重总和——差额就是未评估的部分 */
  ratedWeight: number;
  totalWeight: number;
  /** JD 要求且我 🟢 的 */
  strong: SkillHit[];
  /** JD 要求且我 🟡 的 */
  partial: SkillHit[];
  /** JD 要求但我 🔴 的 —— 短板 */
  gaps: SkillHit[];
  /** JD 要求但我没自评过的 —— 不算短板，算"不知道" */
  unrated: SkillHit[];
  /** 我 🟢 但这条 JD 没要求的 —— 用不上的强项，也是信息 */
  unusedStrengths: string[];
  /** 硬性门槛：年限、学历。不折进分数 */
  gates: Gate[];
  /** 分析用的是哪个字段：正文还是整页兜底文本 */
  source: "body" | "pageText";
  textLength: number;
}

export interface MatchFailure {
  ok: false;
  reason: string;
}

/** 把长文本切成句子。中英标点都要管，否则中文 JD 切不开。 */
function sentences(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[。；！？;!?])/)
    .map((s) => s.trim().replace(/^[\s·•\-–—*]+/, ""))
    .filter((s) => s.length >= 4);
}

/* 岗位要求句的特征词。命中同一个关键词的句子可能有好几句，
   要挑"最像岗位要求的那一句"当依据，而不是文档里第一次出现的那一句。

   ⚠️ 这个改动来自一次真实的失误：拿简历反测词典时，`prompt` 的依据
   引到了文档开头一段改动备注上，而不是项目正文里的提示词设计。
   JD 同理——公司简介段落里先出现关键词，依据就会引到套话上，
   而"依据"是这一页的全部可信度来源，引错了整条结论就废了。 */
const REQ_MARKER = /(负责|要求|熟悉|精通|掌握|具备|需要|经验|优先|加分|能力|职责|设计|搭建|主导|独立|落地)/;

/** 给候选句打分，挑最像岗位要求的那句。分越高越优先。 */
function evidenceScore(sentence: string, indexRatio: number): number {
  let n = 0;
  if (REQ_MARKER.test(sentence)) n += 3;
  // 文档最前面 12% 通常是公司简介/标题/元信息，不是岗位要求
  if (indexRatio > 0.12) n += 1;
  /* 太长的句子当依据不好读，太短的（"任职要求："这种）没有信息量。
     ⚠️ 这行注释原来写的是「30~120 字最合适」，而代码是 `>= 12` ——
     注释和代码差了一个量级。这类不一致最坏：下次改的人会照注释去改代码，
     或者照注释去理解行为，两种都错。
     实际取 12：真实 JD 里「英语工作能力。」这种 7 个字的要求句是有效依据，
     卡到 30 会把它们全排掉。上限 120 才是为了可读性。 */
  if (sentence.length >= 12 && sentence.length <= 120) n += 1;
  // 引用块/表格行往往是备注或话术，不是要求本身
  if (/^[>|]/.test(sentence)) n -= 3;
  return n;
}

/* 中英之间的空格归一化。**这段必须和 jd-insight/extension/lib/gap.js 同步**
 * ——那边是同一套命中判定的移植版，两边任何一处改了另一处必须跟着改。
 *
 * ⚠️ 实测出来的漏判：词典里有 pattern `B端`，而真实 JD 写的是「B 端产品经验」，
 * 中间一个空格，中文 pattern 走 includes() 就整条漏掉。
 * 「B 端」「C 端」「AI 产品」「3 年」在中文技术写作里都常带这个空格。
 *
 * 规则：空格两侧只要有一侧是汉字或中文标点就删掉；纯拉丁词之间的空格保留
 * ——否则 `function call` 被压成 `functioncall`，等于把一个漏判换成另一个。
 */
const CJK_CLASS = "[\\p{Script=Han}\\u3000-\\u303F\\uFF00-\\uFFEF]";
const CJK_SPACE = new RegExp(`(?<=${CJK_CLASS})\\s+|\\s+(?=${CJK_CLASS})`, "gu");
function squash(text: string): string {
  return String(text ?? "").replace(CJK_SPACE, "");
}

/** 关键词是否在句子里出现。英文按词边界，中文直接包含。 */
function hits(sentence: string, pattern: string): boolean {
  const isAscii = /^[\x20-\x7e]+$/.test(pattern);
  // 句子和 pattern 走同一次归一化，否则带空格的 pattern 反而匹配不上
  if (!isAscii) return squash(sentence).includes(squash(pattern));
  // 英文缩写要防误伤：SQL 不该被 "MySQLite" 命中，API 不该被 "RAPID" 命中
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9])" + esc + "($|[^A-Za-z0-9])", "i").test(sentence);
}

/** 从 tagline 或正文里解析硬性门槛 */
function parseGates(texts: string[]): Gate[] {
  const out: Gate[] = [];
  for (const g of GATES) {
    for (const raw of texts) {
      if (!raw) continue;
      let found: { required: string; evidence: string } | null = null;
      for (const p of g.patterns) {
        // years 的 pattern 是正则，degree 的是字面词
        if (g.kind === "years") {
          const m = raw.match(new RegExp(p));
          if (m) found = { required: m[0], evidence: sentenceAround(raw, m[0]) };
        } else if (raw.includes(p)) {
          found = { required: p, evidence: sentenceAround(raw, p) };
        }
        if (found) break;
      }
      if (found) {
        out.push({ id: g.id, label: g.label, required: found.required, evidence: found.evidence });
        break; // 一个门槛只取第一处，tagline 优先于正文
      }
    }
  }
  return out;
}

function sentenceAround(text: string, needle: string): string {
  const s = sentences(text).find((x) => x.includes(needle));
  return (s || text).slice(0, 120);
}

/**
 * 分析一条 JD。
 * @param job 岗位记录
 * @param caps 我的能力自评（来自 career_profile.capabilities）
 */
export function analyzeMatch(job: JobRecord, caps: CapabilityRow[]): MatchResult | MatchFailure {
  const body = (job.body || "").trim();
  const page = (job.pageText || "").trim();

  // 规则 2：没有正文就不给分。判定抽成 usableText()，因为 auditSkill()
  // 必须用**完全一样**的口径算分母——两处各写一遍阈值必然漂。
  const picked = usableText(job);
  if (!picked) {
    return {
      ok: false,
      reason:
        body.length || page.length
          ? `JD 正文只抓到 ${Math.max(body.length, page.length)} 个字，不足以分析。去这个岗位的详情页重新按 Alt+S 存一次。`
          : "这条记录没有 JD 正文。列表页采集经常抓不到正文——去详情页重新存一次。",
    };
  }
  const text = picked;
  const source: "body" | "pageText" = body.length >= MIN_BODY ? "body" : "pageText";

  const levelOf = new Map<string, CapabilityLevel>();
  caps.forEach((c) => levelOf.set(c.group, c.level));

  const sents = sentences(text);
  const allHits: SkillHit[] = [];

  for (const sk of SKILLS) {
    let evidence = "";
    let matched = "";
    let best = -Infinity;
    /* 跨**所有** pattern 的所有命中句里挑最像"岗位要求"的那一句。
       ⚠️ 刻意不做"第一个有命中的 pattern 就停"：那样 patterns 的书写顺序
       会决定依据质量。实测踩过——`prompt` 排在 `提示词` 前面，
       于是依据引到了一行英文关键词列表上，而正文里那几句真实的
       提示词设计根本没参与打分。 */
    for (const p of sk.patterns) {
      sents.forEach((x, i) => {
        if (!hits(x, p)) return;
        const sc = evidenceScore(x, sents.length > 1 ? i / (sents.length - 1) : 1);
        if (sc > best) {
          best = sc;
          evidence = x.slice(0, 160);
          matched = p;
        }
      });
    }
    // 规则 1：没有出处不算命中
    if (!evidence) continue;

    const lv = levelOf.has(sk.group) ? levelOf.get(sk.group)! : null;
    allHits.push({
      id: sk.id,
      label: sk.label,
      group: sk.group,
      weight: sk.weight,
      evidence,
      matched,
      level: lv,
      score: lv == null ? null : LEVEL_SCORE[lv],
    });
  }

  const rated = allHits.filter((h) => h.score != null);
  const ratedWeight = rated.reduce((n, h) => n + h.weight, 0);
  const totalWeight = allHits.reduce((n, h) => n + h.weight, 0);
  const gained = rated.reduce((n, h) => n + h.weight * (h.score as number), 0);
  // 分母只用「有自评」的权重：未评估的项不该被当成 0 分拉低覆盖率，
  // 它们单独列出来提醒"这几项我还没评过"。
  // 一项都没评过时返回 null 而不是 0——0% 会被读成"完全不匹配"。
  const coverage = ratedWeight > 0 ? Math.round((gained / ratedWeight) * 100) : null;

  const hitGroups = new Set(allHits.map((h) => h.group));
  const unusedStrengths = caps
    .filter((c) => c.level === "🟢" && !hitGroups.has(c.group))
    .map((c) => c.group);

  return {
    ok: true,
    coverage,
    ratedWeight,
    totalWeight,
    strong: allHits.filter((h) => h.level === "🟢"),
    partial: allHits.filter((h) => h.level === "🟡"),
    gaps: allHits.filter((h) => h.level === "🔴"),
    unrated: allHits.filter((h) => h.level == null),
    unusedStrengths,
    gates: parseGates([job.tagline || "", text]),
    source,
    textLength: text.length,
  };
}

/** 给列表用的轻量版：只算覆盖率，不返回明细。分析不了就返回 null。 */
export function quickCoverage(job: JobRecord, caps: CapabilityRow[]): number | null {
  const r = analyzeMatch(job, caps);
  return r.ok ? r.coverage : null;
}

/** 覆盖率 → 一句人话。刻意不给"优秀/良好"这种评价词——
 *  它暗示了一个我无法验证的判断。只说事实：JD 要求的能力我覆盖了多少。 */
export function coverageLabel(c: number | null): string {
  if (c == null) return "算不出（命中的能力组都还没自评）";
  if (c >= 80) return "JD 要求的能力大部分我有";
  if (c >= 55) return "一半以上有，有明确短板";
  if (c >= 30) return "短板比强项多";
  return "要求的能力基本不重合";
}
