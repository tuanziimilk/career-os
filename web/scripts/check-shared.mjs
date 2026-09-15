/* 校验工作台（web/）和扩展（extension/）之间"必须一致"的那几份东西。
 *
 * 为什么需要这个：扩展是零构建的纯 JS，工作台是 Vite+TS——两边没有共享包的
 * 机制。可选项只有「各写一份」和「一份权威 + 复制 + 机器校验」，前者的结局是
 * 某天同一个输入在两端得到不同结果，而这种不一致只在数据对不上时才被发现，
 * 极难定位。所以选后者，并且把校验挂进 build，让分叉在构建时就断掉。
 *
 * 用法：
 *   npm run check:shared          只校验，不一致就非零退出
 *   npm run check:shared -- --fix 按权威来源重新生成/复制
 *
 * ── 两份共享物，方向不同，别搞反 ──────────────────────────
 * 1) 薪资解析 salary.js
 *    权威在**扩展**（它先有，而且采集端是这套规则的第一现场）。
 *    工作台那份是原样复制，要求**字节一致**。
 * 2) 技能词典 skills.json
 *    权威在**工作台**（校准记录 calibration 在那边，是它的历史）。
 *    扩展那份是**生成**出来的 ESM 模块 lib/skills.js，要求**内容一致**。
 *    为什么生成而不是直接 import .json：JSON 模块导入要 import attributes，
 *    Chrome 123+ 才支持；万一用户的 Chrome 不支持，整个情报台会在模块加载
 *    阶段失败，而这个风险在开发机上验证不了（Node 支持 ≠ Chrome 支持）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FIX = process.argv.includes("--fix");

const P = {
  salaryExt: resolve(root, "../extension/lib/salary.js"),
  salaryWeb: resolve(root, "src/lib/salary.js"),
  skillsWeb: resolve(root, "src/data/skills.json"),
  skillsExt: resolve(root, "../extension/lib/skills.js"),
};

const rel = (p) => relative(root, p).replace(/\\/g, "/");
const problems = [];

/* ---------------------------------------------- 1. salary.js 内容一致 */
/* ⚠️ 比的是**规范化行尾之后**的内容，不是原始字节。2026-09-15 合并单仓库时
   踩到：git 的 core.autocrlf=true 会在 checkout 时把 LF 写成 CRLF，于是
   「刚被 checkout 出来的那一份」和「一直躺在工作区没被重新 checkout 的那一份」
   字节必然不同，而内容一模一样。原来的 a.equals(b) 因此会在任何一次
   fresh clone 之后随机翻脸 —— 它测的其实是"这两个文件有没有走过同一条
   checkout 路径"，不是"内容一不一致"。
   这也正是 check-line-endings.mjs 文件头定下的原则：不靠把文件都转成 LF，
   而是在**读取层**兜住行尾差异。这里就是一个读取层。 */
const lf = (buf) => buf.toString("utf8").split("\r\n").join("\n");
const sameText = (x, y) => lf(x) === lf(y);
{
  const a = readFileSync(P.salaryExt);
  const b = readFileSync(P.salaryWeb);
  if (sameText(a, b)) {
    console.log(`✓ 薪资解析两端内容一致（${rel(P.salaryWeb)}）`);
  } else if (FIX) {
    writeFileSync(P.salaryWeb, a);
    console.log(`↻ 已按扩展那份重写 ${rel(P.salaryWeb)}`);
  } else {
    problems.push(
      `薪资解析两端不一致。\n` +
        `    权威：${rel(P.salaryExt)}（扩展）\n` +
        `    副本：${rel(P.salaryWeb)}\n` +
        `    修：npm run check:shared -- --fix`
    );
  }
}

/* ------------------------------------- 2. skills：JSON → 生成 ESM 模块 */
const SKILLS_HEADER = `/* 技能词典 —— **自动生成，不要手改这个文件。**
 *
 * 权威来源：web/src/data/skills.json（那边有校准记录 calibration）。
 * 由 web/scripts/check-shared.mjs 生成与校验：
 *   npm run check:shared           只校验，不一致就报错
 *   npm run check:shared -- --fix  按权威来源重新生成这个文件
 *
 * 为什么不直接 import 那个 .json：
 *   JSON 模块导入要写 with { type: "json" }，Chrome 123+ 才支持。
 *   万一用户的 Chrome 不支持，整个情报台会在模块加载阶段直接失败——
 *   而这个风险在开发机上验证不了（Node 支持不代表 Chrome 支持）。
 *   生成一个普通 ESM 模块，把这个不确定性彻底去掉。
 */
`;

function renderSkills(json) {
  return SKILLS_HEADER + "export default " + JSON.stringify(json, null, 2) + ";\n";
}

/** 从生成的模块里把对象抠回来，用于内容比对（不 import，避免受运行时支持影响）。 */
function parseGenerated(text) {
  const i = text.indexOf("export default ");
  if (i < 0) return null;
  const body = text.slice(i + "export default ".length).replace(/;\s*$/, "");
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

{
  const authoritative = JSON.parse(readFileSync(P.skillsWeb, "utf8"));
  let current = null;
  try {
    current = parseGenerated(readFileSync(P.skillsExt, "utf8"));
  } catch {
    current = null; // 文件不存在
  }
  const same = current && JSON.stringify(current) === JSON.stringify(authoritative);
  const n = authoritative.skills?.length ?? 0;
  if (same) {
    console.log(`✓ 技能词典两端内容一致（${n} 条技能 → ${rel(P.skillsExt)}）`);
  } else if (FIX) {
    writeFileSync(P.skillsExt, renderSkills(authoritative));
    console.log(`↻ 已按 ${rel(P.skillsWeb)} 生成 ${rel(P.skillsExt)}（${n} 条技能）`);
  } else {
    problems.push(
      `技能词典两端不一致${current ? "" : "（扩展那份缺失或解析不了）"}。\n` +
        `    权威：${rel(P.skillsWeb)}（工作台）\n` +
        `    生成：${rel(P.skillsExt)}\n` +
        `    修：npm run check:shared -- --fix`
    );
  }
}

/* ------------------------------------- 3. 漏斗常量：两端各写一份，无权威方 */
/* 这是 MAINTENANCE 里记了很久的「没有闸门的三处重复」的第 2、3 条：
 *   · FAIL_BUCKETS 在 pipeline.js 和 funnel.ts 各写一份
 *   · silentDays = 14 在两处各写死
 *
 * 和上面两份共享物不同，这组**没有"权威方 + 复制"的结构** ——
 * funnel.ts 是 pipeline.js 的 TS 移植，两边都是手写的正本。
 * 所以这里不能 --fix（不知道该按哪边改），只能报出来让人决定。
 *
 * ⚠️ silentDays 用**行为**比，不比字面量：
 * 它在两边都是默认参数（`silentDays = 14` / `opts.silentDays || 14`），
 * 抠字面量要写一个会随写法变化而失效的正则。
 * 构造"沉默了正好 14 天"和"13 天"两条记录，看两边判定是否一致 ——
 * 这样连"其中一边把 >= 改成 >"这种改动也能抓到，而比字面量抓不到。
 */
{
  const ext = await import("../../extension/lib/pipeline.js");
  const web = await import("../src/lib/funnel.ts");

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pairs = [
    ["FAIL_BUCKETS", ext.FAIL_BUCKETS, web.FAIL_BUCKETS],
    ["TERMINAL", ext.TERMINAL, web.TERMINAL],
    ["STATUS_CYCLE", ext.STATUS_CYCLE, web.STATUS_CYCLE],
    ["STAGES 的 id 顺序", ext.STAGES.map((s) => s.id), web.STAGES.map((s) => s.id)],
    [
      "STAGES 的 optional 标记",
      ext.STAGES.map((s) => !!s.optional),
      web.STAGES.map((s) => !!s.optional),
    ],
  ];
  for (const [name, a, b] of pairs) {
    if (eq(a, b)) {
      console.log(`✓ 漏斗常量 ${name} 两端一致（${Array.isArray(a) ? a.length + " 项" : ""}）`);
    } else {
      problems.push(
        `漏斗常量 ${name} 两端不一致（两边都是手写正本，没有权威方，--fix 修不了）。\n` +
          `    扩展 extension/lib/pipeline.js：${JSON.stringify(a)}\n` +
          `    工作台 src/lib/funnel.ts：${JSON.stringify(b)}\n` +
          `    决定哪边对，然后手改另一边。`
      );
    }
  }

  /* silentDays 的行为比对 */
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const mk = (n) => [
    {
      jobKey: "k",
      title: "t",
      status: "已投",
      statusHistory: [{ status: "已投", at: daysAgo(n) }],
    },
  ];
  const probe = [
    [14, true, "沉默正好 14 天：两端都该算「该跟进」"],
    [13, false, "沉默 13 天：两端都不该算"],
  ];
  for (const [days, want, label] of probe) {
    const a = ext.needsFollowUp(mk(days)).length > 0;
    const b = web.needsFollowUp(mk(days)).length > 0;
    if (a === b && a === want) {
      console.log(`✓ ${label}`);
    } else {
      problems.push(
        `silentDays 的判定两端不一致或都不对：${label}\n` +
          `    扩展：${a ? "算" : "不算"} · 工作台：${b ? "算" : "不算"} · 期望：${want ? "算" : "不算"}`
      );
    }
  }
}

/* ------------------------------------------------------------------ */
if (problems.length) {
  console.error("\n✗ 共享物校验未通过：\n");
  problems.forEach((p) => console.error("  - " + p + "\n"));
  process.exit(1);
}
