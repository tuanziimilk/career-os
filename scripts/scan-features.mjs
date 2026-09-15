/* 生成功能清册的骨架 —— docs/FEATURES.md 的机器部分。
 *
 *     node scripts/scan-features.mjs           人读的报告
 *     node scripts/scan-features.mjs --json    机器读的 JSON
 *
 * ══════════ 为什么需要它 ══════════
 *
 * 这个项目的文档一直只有一类：ARCHITECTURE / PRD / ROADMAP 记的都是
 * **「为什么这么定」**，是决策档案。缺的是**「现在有什么」**的资产清册。
 *
 * 缺它的症状，2026-09-14 那次盘点里一次见到了三种：
 *   - 已经做完并上线的功能被当成待办重新规划（引用校验，09-11 就做完了）
 *   - 写完的函数没有任何调用者（funnel / needsFollowUp / 能力自评写入，三次）
 *   - 注释里承诺的东西对不上账（有的没做，有的**其实做了但清册说没做**）
 *
 * 根因不是"想得不清楚"，是**跨会话协作的状态载体只有文档**：每开一个新会话，
 * 读文档重建出来的是决策语境，不是系统现状，于是每次都漏一点。
 *
 * ⚠️ **它只生成骨架，不生成结论。** 「在用 / 有测试 / 是不是故意留的」
 * 这几列必须人工判断 —— 机器能告诉你「这个符号没人用」，
 * 不能告诉你「它是为测试导出的还是忘了删」。
 *
 * ⚠️ 判据是**文本匹配**，不是真解析：
 *   - 「谁 import 了我」靠文件名出现在别的文件的引号里
 *   - 「这个导出有没有人用」靠符号名在别处出现过
 *   两者都会**漏报少、误判多**（动态拼出来的路径、同名变量都会骗过它）。
 *   宁可这样：误报会被人工筛掉，漏报会让人以为已经查过了。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, basename, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* 扫描范围。合并单仓库后全部是仓库内相对路径 ——
   2026-09-15 之前这里写的是 ../jd-insight 和 ../career-web 这种跨仓库路径，
   那种写法的问题是：目录找不到时 walk() 静默返回空，
   脚本会**扫零个文件然后报告一切正常**。 */
const SCAN = [
  ["extension", join(ROOT, "extension")],
  ["analyzer", join(ROOT, "analyzer")],
  ["scripts", join(ROOT, "scripts")],
  ["web", join(ROOT, "web", "src")],
  ["web-scripts", join(ROOT, "web", "scripts")],
];
const EXTS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIP = new Set(["node_modules", "dist", "icons", ".git", "__pycache__"]);

/* 已知的「故意导出但无人使用」白名单。加进来之前先问一句：
   是真的故意，还是只是懒得删？理由必须写出来。 */
const ALLOW_ORPHAN = new Map([
  // "extension/lib/xxx.js::someSymbol", "给 eval-xxx.mjs 用的，不进运行时"
]);

const files = [];
function walk(dir, area) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // ⚠️ 和 check-line-endings.mjs 同一个坑：目录不存在时别静默通过。
    console.error(`!! 扫描目录不存在：${dir}\n   路径写错了，或者目录结构又变了。`);
    process.exitCode = 1;
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(p, area);
    } else if (EXTS.has(extname(e.name))) {
      files.push({ p, area, rel: relative(ROOT, p).split("\\").join("/") });
    }
  }
}
for (const [area, dir] of SCAN) if (existsSync(dir) || true) walk(dir, area);

/* ⚠️ 读进来就统一行尾。不统一的话按 \n 切行时每行尾部会挂一个 \r，
   而 JS 正则里的 `.` 不匹配 \r —— 「注释里的承诺」那段的行匹配会在 CRLF
   文件上整段失效，而且不报错。这条约定由 web/scripts/check-line-endings.mjs
   守着，它在 2026-09-15 当场逮到了这个脚本的第一版。

   写法刻意用它文档里给的那个正则形式，而不是 split("\r\n").join("\n") ——
   那道闸门是启发式的，只认几种固定写法，换个等价写法它认不出来会误报。
   为一条约定保持同一种写法，比证明自己的写法也对更省事。 */
const readText = (p) => readFileSync(p, "utf8").replace(/\r\n?/g, "\n");
const src = new Map(files.map((f) => [f.p, readText(f.p)]));

const EXPORT_DECL = /export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /export\s*\{([^}]+)\}/g;

const rows = files.map((f) => {
  const s = src.get(f.p);
  const ex = [];
  let m;
  EXPORT_DECL.lastIndex = 0;
  while ((m = EXPORT_DECL.exec(s))) ex.push(m[1]);
  EXPORT_LIST.lastIndex = 0;
  while ((m = EXPORT_LIST.exec(s))) {
    for (const x of m[1].split(",")) {
      const n = x.split(/\s+as\s+/).pop().trim();
      if (n && n !== "default") ex.push(n);
    }
  }
  if (/export\s+default/.test(s)) ex.push("default");

  const base = basename(f.p).replace(/\.(js|mjs|ts|tsx)$/, "");
  const impRe = new RegExp(`["'][^"']*${base}(\\.(js|mjs|ts|tsx))?["']`);
  const importers = files.filter((g) => g.p !== f.p && impRe.test(src.get(g.p)));

  const orphans = ex.filter((n) => {
    if (n === "default") return false;
    if (ALLOW_ORPHAN.has(`${f.rel}::${n}`)) return false;
    const re = new RegExp(`\\b${n}\\b`);
    return !files.some((g) => g.p !== f.p && re.test(src.get(g.p)));
  });

  return { ...f, lines: s.split("\n").length, exports: ex, importers: importers.length, orphans };
});

/* 注释里的承诺。这些是「📝 承诺了但不存在」的候选来源。 */
const PROMISE = /(?:\/\/|\*|#).*?(回头|之后再|待补|待做|TODO|FIXME|还没做|尚未实现)/;
const promises = [];
for (const f of files) {
  if (f.rel === "scripts/scan-features.mjs") continue; // 别匹配自己的正则字面量
  src
    .get(f.p)
    .split("\n")
    .forEach((line, i) => {
      if (PROMISE.test(line)) promises.push({ file: f.rel, line: i + 1, text: line.trim().slice(0, 100) });
    });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ rows, promises }, null, 2));
  process.exit(process.exitCode || 0);
}

rows.sort((a, b) => a.rel.localeCompare(b.rel));

console.log("── 模块一览 ──");
console.log("  " + "文件".padEnd(46) + "行数".padStart(6) + "导出".padStart(6) + "被引".padStart(6));
for (const r of rows) {
  console.log(
    "  " + r.rel.padEnd(46) + String(r.lines).padStart(6) +
      String(r.exports.length).padStart(6) + String(r.importers).padStart(6)
  );
}

const zeroImp = rows.filter((r) => r.importers === 0 && r.exports.length > 0 && !r.rel.endsWith(".d.ts"));
console.log(`\n── 零引用文件（有导出但没有任何文件 import 它）·${zeroImp.length} 个 ──`);
for (const r of zeroImp) console.log(`  ${r.rel}\n      exports: ${r.exports.join(", ")}`);
console.log("  提示：入口文件（popup.js / sidepanel.js / 各 eval 脚本）本来就没人 import，正常。");

const orph = rows.filter((r) => r.orphans.length);
const total = orph.reduce((n, r) => n + r.orphans.length, 0);
console.log(`\n── 导出了但全项目找不到使用处 · ${total} 个符号 ──`);
for (const r of orph) console.log(`  ${r.rel}\n      → ${r.orphans.join(", ")}`);
console.log(
  "  这一类是本项目反复出现的失败模式（💤 实现完整零调用者，已出现三次）。\n" +
  "  逐条判断：用起来 / 删掉 / 加进脚本里的 ALLOW_ORPHAN 并写明理由。"
);

console.log(`\n── 注释里的承诺 · ${promises.length} 处 ──`);
for (const p of promises.slice(0, 30)) console.log(`  ${p.file}:${p.line}  ${p.text}`);
if (promises.length > 30) console.log(`  …… 还有 ${promises.length - 30} 处`);
console.log(
  "  每一条都该在 docs/FEATURES.md 里有对应行 —— 要么已实现，要么标 📝。\n" +
  "  注意两个方向都会错：承诺了没做，和做了但清册还记着没做。\n" +
  "  后者 2026-09-15 真的发生过：薪资补录 UI 一直在 popup.js:250，而清册标着不存在。"
);

console.log("\n⚠️ 以上全部是文本匹配的结果，不是真解析。误判要人工筛，别直接照抄进 FEATURES.md。");
