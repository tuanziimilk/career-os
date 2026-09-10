/* 校验 career-web 和扩展之间"必须一致"的那几份东西。
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
  salaryExt: resolve(root, "../jd-insight/extension/lib/salary.js"),
  salaryWeb: resolve(root, "src/lib/salary.js"),
  skillsWeb: resolve(root, "src/data/skills.json"),
  skillsExt: resolve(root, "../jd-insight/extension/lib/skills.js"),
};

const rel = (p) => relative(root, p).replace(/\\/g, "/");
const problems = [];

/* ---------------------------------------------- 1. salary.js 字节一致 */
{
  const a = readFileSync(P.salaryExt);
  const b = readFileSync(P.salaryWeb);
  if (a.equals(b)) {
    console.log(`✓ 薪资解析两端字节一致（${rel(P.salaryWeb)}）`);
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
 * 权威来源：career-web/src/data/skills.json（那边有校准记录 calibration）。
 * 由 career-web/scripts/check-shared.mjs 生成与校验：
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

/* ------------------------------------------------------------------ */
if (problems.length) {
  console.error("\n✗ 共享物校验未通过：\n");
  problems.forEach((p) => console.error("  - " + p + "\n"));
  process.exit(1);
}
