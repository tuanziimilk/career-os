#!/usr/bin/env node
/* 找「导出了但全项目没人用」的符号。
 *
 *     node scripts/check-orphans.mjs
 *
 * ══════════ 为什么值得单开一道闸门 ══════════
 *
 * 这个项目反复出现同一种失败：**实现完整、但零调用者**。
 * `docs/FEATURES.md` 用 💤 标它，已经记了三例：
 *   · `needsFollowUp()` 写好了，对话侧没有意图路由到它
 *   · `stats()` 算出了城市分布，`answerStats` 没路由
 *   · 设置页手填价格，字段在、界面删了（这条是故意的）
 *
 * 而 FEATURES §3.1 那张「导出了但可能没人用」的表，11 项**全打着 ❓** ——
 * 它是一次性人工 grep 的猜测，没人复核，也不会随代码更新。
 * FEATURES §4 自己提议过这道闸门，说它「直接杀掉 💤 这一类的复发」。这就是它。
 *
 * ══════════ 白名单不是豁免，是登记 ══════════
 *
 * 有些导出确实该零调用者：给测试用的、给未来 UI 预留的常量、
 * 故意保留的兼容字段。这些**不是删掉了事，是要写下理由**。
 * 所以白名单每条必须有 `why`，而且**多余的白名单条目也会报错** ——
 * 否则删了代码没删白名单，这张表就开始腐烂，和它要治的病一模一样。
 *
 * （同一个模式在 `check-thresholds.mjs` 用过：登记表 + 机器逐条核对，
 *   改了代码没改表、或反过来，都让 build 失败。所以表不是文档，是契约。）
 *
 * ══════════ 这个脚本的局限，别当它没有 ══════════
 *
 * 判据是**标识符文本出现在别的文件里**，不是真解析。所以：
 *   · 动态调用（`obj[name]()`、字符串拼出来的名字）它看不见 → 可能误报
 *   · 同名但无关的变量会被算成"有人用" → 可能漏报
 * 两个方向都可能错。选它是因为写一个真解析器要处理 JS/TS 两套语法，
 * 而那种解析器的失败方式是**在你以为检查了的时候其实没检查** ——
 * 这个项目在 `eval-capability-note` 的正则剥类型器上已经吃过一次。
 * 笨办法错的时候会报出来让人看，聪明办法错的时候是静默放过。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ALLOWLIST = join(HERE, "orphan-allowlist.json");

/* 扫哪些目录找「导出」。刻意只扫库代码 —— 页面组件的默认导出由路由表消费，
   闸门脚本的导出多数是给同目录的别的脚本用的，都不是这道闸门的目标。 */
const EXPORT_DIRS = [
  join(ROOT, "extension", "lib"),
  join(ROOT, "web", "src", "lib"),
];
/* 到哪里找「使用」。范围要比上面大得多 —— 测试、闸门、页面都算调用方。 */
const USAGE_DIRS = [
  join(ROOT, "extension"),
  join(ROOT, "web", "src"),
  join(ROOT, "web", "scripts"),
  join(ROOT, "scripts"),
];
const EXTS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "icons"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), out);
    } else if (EXTS.has(extname(e.name))) {
      /* ⚠️ `.d.ts` 一律跳过。类型声明是隐式加载的，永远"零引用"——
         FEATURES §3.1 已经把这一条记成扫描器的假阳性了。 */
      if (e.name.endsWith(".d.ts")) continue;
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

/* 抓具名导出。刻意不认 `export default`（默认导出没有稳定的名字可搜）
   和 `export * from`（转发，不是定义）。 */
/* ⚠️ 标识符用 \p{L} 而不是 [A-Za-z]：JS 允许非 ASCII 标识符。
   这个项目现在全是 ASCII，但一个**只认 ASCII 的检查器**会静默跳过
   将来某个中文命名的导出 —— 而"静默跳过"正是这道闸门要治的病。
   （2026-09-16 验证闸门时发现的：我用中文函数名做测试用例，它没报，
     一开始还以为是闸门坏了。） */
const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gmu;
/* `export { a, b as c }` 这种 */
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}/gm;

const exportFiles = EXPORT_DIRS.flatMap((d) => walk(d));
const usageFiles = USAGE_DIRS.flatMap((d) => walk(d));
const usageCache = new Map();
for (const f of usageFiles) usageCache.set(f, readFileSync(f, "utf8"));

const found = [];
for (const f of exportFiles) {
  const src = usageCache.get(f) ?? readFileSync(f, "utf8");
  const names = new Set();
  let m;
  const a = new RegExp(EXPORT_RE.source, EXPORT_RE.flags);
  while ((m = a.exec(src)) !== null) names.add(m[1]);
  const b = new RegExp(EXPORT_LIST_RE.source, EXPORT_LIST_RE.flags);
  while ((m = b.exec(src)) !== null) {
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) && name !== "default") names.add(name);
    }
  }
  for (const name of names) found.push({ name, file: f });
}

/** 这个名字在**别的文件**里出现过几次（整词匹配）。 */
function usedElsewhere(name, ownFile) {
  const re = new RegExp("\\b" + name.replace(/\$/g, "\\$") + "\\b");
  const hits = [];
  for (const [f, src] of usageCache) {
    if (f === ownFile) continue;
    if (re.test(src)) hits.push(rel(f));
  }
  return hits;
}

/* ⚠️ 闸门的自检。
 *
 * 2026-09-16 真实发生：我把标识符正则从 `[A-Za-z_$]` 换成 `\p{L}`，
 * 但下面重建正则时写死了 `"gm"`，**把 `u` 标志丢了** ——
 * 非 unicode 模式下 `\p{L}` 就是字面量 `p{L}`，于是匹配到的导出
 * 从 124 个掉到 9 个，而脚本**照常打印「全部对得上」并退出 0**。
 *
 * 也就是说：我在"改进"这道闸门的同一次改动里，静默地废掉了它。
 * 这正是本文件头写的那句「聪明办法错的时候是静默放过」。
 *
 * 所以加一条下限：一个有 27 个库文件的仓库不可能只有几个具名导出。
 * 这个数字不需要精确，它只要能区分「正常」和「扫描器废了」。
 */
const MIN_EXPECTED_EXPORTS = 40;
if (found.length < MIN_EXPECTED_EXPORTS) {
  console.error(
    `
✗ 只扫到 ${found.length} 个具名导出（${exportFiles.length} 个库文件）——` +
      `少得不正常。`
  );
  console.error("   几乎一定是**扫描器本身坏了**，不是仓库真的没有导出。");
  console.error("   先查 EXPORT_RE：重建正则时有没有丢掉 flags（u 标志尤其容易丢）。");
  process.exit(1);
}

const orphans = [];
for (const { name, file } of found) {
  const hits = usedElsewhere(name, file);
  if (hits.length === 0) orphans.push({ name, file: rel(file) });
}

/* ── 和白名单对账 ── */
let allow = [];
if (existsSync(ALLOWLIST)) allow = JSON.parse(readFileSync(ALLOWLIST, "utf8")).allowed || [];
const allowKey = (x) => x.file + "::" + x.name;
const allowMap = new Map(allow.map((a) => [allowKey(a), a]));

const unexpected = orphans.filter((o) => !allowMap.has(allowKey(o)));
const stale = allow.filter((a) => !orphans.some((o) => allowKey(o) === allowKey(a)));

console.log(`扫了 ${exportFiles.length} 个库文件里的 ${found.length} 个具名导出，`);
console.log(`在 ${usageFiles.length} 个文件里找使用处。\n`);

console.log("── 零调用者、且已登记 ──");
for (const a of allow) {
  const still = orphans.some((o) => allowKey(o) === allowKey(a));
  console.log(`  ${still ? "ok  " : "过期"} ${a.file} :: ${a.name}  —— ${a.why}`);
}
if (!allow.length) console.log("  （白名单是空的）");

let fail = 0;

if (unexpected.length) {
  fail += unexpected.length;
  console.log("\n✗ 新出现的零调用者（没登记）：");
  for (const o of unexpected) console.log(`    ${o.file} :: ${o.name}`);
  console.log("\n  三选一，别放着：");
  console.log("    1. 用起来 —— 它本来就该有调用方（💤 那一类）");
  console.log("    2. 删掉   —— 确认是遗留");
  console.log("    3. 登记   —— 确实该零调用（给测试用 / 预留常量 / 兼容字段），");
  console.log("                 写进 scripts/orphan-allowlist.json 并说明理由");
}

if (stale.length) {
  fail += stale.length;
  console.log("\n✗ 白名单里有多余条目（它们现在有调用者了，或者已经删掉了）：");
  for (const a of stale) console.log(`    ${a.file} :: ${a.name}`);
  console.log("\n  从 scripts/orphan-allowlist.json 里删掉这几条。");
  console.log("  ⚠️ 这一项也算失败是刻意的：删了代码不删白名单，");
  console.log("     这张表就开始腐烂 —— 和它要治的病一模一样。");
}

console.log("");
if (fail) {
  console.log(`!! ${fail} 项待处理`);
  process.exit(1);
}
console.log(`全部对得上（${allow.length} 个已登记的零调用导出）`);
