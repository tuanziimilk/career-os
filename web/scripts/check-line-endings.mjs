/* 检查「按行解析文件」的地方有没有做行尾统一。
 *
 *     node web/scripts/check-line-endings.mjs
 *
 * ══════════ 为什么需要这道闸门 ══════════
 *
 * 2026-09-11 实测的一个**静默数据清空**：
 * `面试题库.md` 是 CRLF，而题库正则 `/^\s*-\s*\*\*(.+?)\*\*\s*(.+)$/` 里
 * **JS 的 `.` 不匹配 `\r`**（和 `\n` 一样算行终止符），于是 `(.+)$` 永远
 * 走不到字符串末尾，139 行一条都匹配不上。模块正则没锚 `$`，照常工作。
 *
 * 症状：模块 85 张卡全在、题目 0 条、**脚本不报错**，然后把 questions.json
 * 覆盖成 `[]` —— 39 道题连同它们在云端的作答记录一起变成孤儿。
 *
 * ⚠️ 根因是语言层面的差异，实测确认过：
 *     Python 文本模式读 'a\r\nb' → 'a\nb'   （自动统一，universal newlines）
 *     Node readFileSync 读同一文件 → 'a\r\nb' （原样）
 * 所以 `analyzer/` 那一侧天然免疫，**只有 JS/TS 侧有这个问题**。
 *
 * ⚠️ 而知识库的行尾是**混着的**：43 个 md 里只有 3 个是 CRLF。
 * 这意味着这个 bug 只会零星发作 —— 改一个文件好了，换一个文件又坏，
 * 最难排查的那种。所以不能靠"把文件都转成 LF"，得在读取层兜住。
 *
 * 这个脚本查的是**约定有没有被遵守**：凡是 Node 侧读文本文件再按行解析的，
 * 读取函数必须做行尾统一。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/* 要扫的范围：扩展侧与工作台侧的 JS/TS。刻意不扫 analyzer/（Python 天然免疫）
   和 node_modules / dist。 */
const SCAN_DIRS = [
  join(ROOT, "web", "src"),
  join(ROOT, "web", "scripts"),
  join(ROOT, "extension"),
  join(ROOT, "scripts"),
];
const EXTS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "icons", ".git"]);

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
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/* 「读了文件」的信号。只认 Node 的 fs 读取 —— 浏览器里的 File.text() 和
   DOM textContent 不走这条路（DOM 规范化成 \n），不是这个 bug 的范围。 */
const READS_FILE = /readFileSync\s*\(/;
/* 「按行解析」的信号：split 出行，或用了 re 的多行锚 */
const SPLITS_LINES = /\.split\s*\(\s*["'`]\\n["'`]\s*\)|\.split\s*\(\s*\/\[?\\[nr]/;
/* 「做了行尾统一」的信号：显式替换 \r，或 split 里就带了 \r */
const NORMALIZES =
  /replace\s*\(\s*\/\\r\\n\?\/g|replace\s*\(\s*\/\\r\/g|split\s*\(\s*\/\\r\?\\n\/|split\s*\(\s*\/\[\\n\\r\]/;

let fail = 0;
const files = SCAN_DIRS.flatMap((d) => walk(d));

console.log("── 读文件 + 按行解析的地方 ──");
let checked = 0;

for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  const src = readFileSync(f, "utf8");
  if (!READS_FILE.test(src) || !SPLITS_LINES.test(src)) continue;
  checked += 1;

  if (NORMALIZES.test(src)) {
    console.log("  ok    " + rel + "  （有行尾统一）");
  } else {
    console.log("  FAIL  " + rel);
    console.log("        读了文件又按 \\n 切行，但没看到行尾统一。");
    console.log("        CRLF 文件会让 `(.+)$` 这类正则整段匹配不上，而且不报错。");
    console.log("        修法：读取处 .replace(/\\r\\n?/g, \"\\n\")，或 split(/\\r?\\n/)。");
    fail += 1;
  }
}

if (checked === 0) console.log("  （没有同时满足「读文件」和「按行切分」的文件）");

/* 顺带报告知识库的行尾分布 —— 它是这个问题的源头，
   而「混着的」这个事实本身就值得每次看见。 */
console.log("\n── 知识库 md 文件的行尾分布 ──");
/* ⚠️ 知识库**不在这个仓库里**，它是仓库的兄弟目录，而且从来没进过版本控制。
   2026-09-15 单仓库合并时差点丢掉这一段：ROOT 从「两个仓库的公共父目录」
   变成了「仓库根」，于是 join(ROOT, "career-knowledgebase") 指向了
   <repo>/career-knowledgebase —— 不存在，而 walkMd 找不到目录就静默跳过，
   这道闸门会照常打印「全部通过」。
   而这一段恰恰是这个脚本存在的理由：那次静默清空 39 道题的 CRLF bug，
   源头就是知识库里的 面试题库.md。所以两个位置都找一下，
   仓库内优先（将来真把知识库纳进来时不用再改）。 */
const KB = [join(ROOT, "career-knowledgebase"), join(ROOT, "..", "career-knowledgebase")].find(
  (p) => existsSync(p)
) || join(ROOT, "..", "career-knowledgebase");
const md = [];
(function walkMd(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === ".obsidian" || SKIP_DIRS.has(e.name)) continue;
      walkMd(join(dir, e.name));
    } else if (e.name.endsWith(".md")) {
      md.push(join(dir, e.name));
    }
  }
})(KB);

if (md.length === 0) {
  console.log("  （找不到知识库，跳过。它不在版本控制里，别人克隆仓库时没有这个目录）");
} else {
  const crlf = md.filter((p) => readFileSync(p).includes(Buffer.from("\r\n")));
  console.log(`  ${md.length} 个 md：CRLF ${crlf.length} 个 / LF ${md.length - crlf.length} 个`);
  if (crlf.length && crlf.length < md.length) {
    console.log("  ⚠️ 行尾是**混着的** —— 这个 bug 会零星发作：");
    console.log("     改一个文件好了、换一个文件又坏，最难排查的那种。");
    console.log("     所以不靠「把文件都转成 LF」，靠读取层兜住（见上）。");
    for (const p of crlf.slice(0, 6)) {
      console.log("       CRLF: " + relative(ROOT, p).replace(/\\/g, "/"));
    }
  }
}

console.log("");
console.log(
  "⚠️ 这个脚本是**启发式**的：靠正则找「读文件 + 按行切」的组合，" +
  "不做真解析。\n   它会漏掉换一种写法的读取（比如自己包一层 helper 再间接调用）。" +
  "\n   不过它错的时候是漏报不是误报 —— 误报会让人学会忽略输出，那更糟。"
);

if (fail) {
  console.log(`\n!! ${fail} 处没有行尾统一`);
  process.exit(1);
}
console.log("\n全部通过");
