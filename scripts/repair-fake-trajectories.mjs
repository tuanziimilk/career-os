#!/usr/bin/env node
/* 清掉旧交互伪造出来的状态轨迹。
 *
 *     node jd-insight/scripts/repair-fake-trajectories.mjs data/jd_backup.json          # 只看，不写
 *     node jd-insight/scripts/repair-fake-trajectories.mjs data/jd_backup.json --write  # 写出 .repaired.json
 *
 * ══════════ 它在修什么 ══════════
 *
 * 旧 popup 的状态是一个在八档里循环点击的 chip：标成「已拒」要点 7 下，
 * 每一下 pushStatus 都追加一条带时间戳的历史。于是一条从没投过的记录，
 * 轨迹里会躺着 已投 / 进面 / 复面 / offer 四条假的，而漏斗照单全收。
 *
 * ══════════ 判据：怎么认出哪几条是假的 ══════════
 *
 * 靠**时间**。人真的走完一轮面试要按周算；循环点击是几秒钟之内连点出来的。
 * 所以：同一条记录里，相邻两档间隔小于 GAP_MS 的，判为连点。
 *
 * ⚠️ 这个判据会漏，也会误伤：
 *   · 漏：隔天补记的假轨迹认不出来（间隔是真的）
 *   · 误伤：真的当天连收两档（面完当场给 offer）会被当成连点
 * 所以**默认只打印，不写**，而且写出来的是新文件不是原地改。
 * 有疑问的那几条自己看 —— 这是十来条的量级，不是一千条。
 *
 * ══════════ 保留哪一档 ══════════
 *
 * 连点段里**只留最后一档**（那是你真正想标的那个），中间的全删。
 * 起点那条（采集/首档）永远保留 —— 它不是点出来的。
 */
import { readFileSync, writeFileSync } from "node:fs";

const GAP_MS = 90 * 1000; // 90 秒。连点是秒级，真实流转是天级，中间这段空得很

const file = process.argv[2];
const doWrite = process.argv.includes("--write");
if (!file) {
  console.error("用法：node scripts/repair-fake-trajectories.mjs <备份 json> [--write]");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const recs = Array.isArray(raw) ? raw : raw.jds || [];
if (!recs.length) {
  console.error("这个文件里没有记录。确认导出的是 popup 的「备份 JSON」。");
  process.exit(2);
}

let touched = 0;
const out = recs.map((r) => {
  const hist = r.statusHistory || [];
  if (hist.length < 3) return r; // 少于三条不可能是连点出来的一串

  /* 标记要删的：不是第一条、且和下一条的间隔 < GAP_MS。
     用"和下一条的间隔"而不是"和上一条"——因为要留的是段尾。 */
  const drop = hist.map((h, i) => {
    if (i === 0 || i === hist.length - 1) return false;
    const t = Date.parse(h.at || "");
    const tn = Date.parse(hist[i + 1]?.at || "");
    if (!Number.isFinite(t) || !Number.isFinite(tn)) return false; // 时间戳坏了就不动它
    return tn - t < GAP_MS;
  });
  // 段尾那条如果和它前一条也是连点，说明整段都是点出来的，前面的都删
  const kept = hist.filter((_, i) => !drop[i]);
  if (kept.length === hist.length) return r;

  touched++;
  const label = (r.company || "?") + " / " + (r.title || "?").split("\n")[0].slice(0, 20);
  console.log("\n" + label);
  console.log("  原  " + hist.map((h) => h.status).join(" → "));
  console.log("  改  " + kept.map((h) => h.status).join(" → "));
  console.log("  删掉 " + (hist.length - kept.length) + " 条");
  return { ...r, statusHistory: kept };
});

console.log(
  "\n共 " + recs.length + " 条记录，" + touched + " 条有连点痕迹。" +
    (touched ? "" : "（干净，不用修）")
);

if (!touched) process.exit(0);

if (!doWrite) {
  console.log(
    "\n只是看看，没动任何文件。\n" +
      "上面每一条都自己核一遍——判据是时间间隔，会误伤「面完当场给 offer」这种。\n" +
      "确认没问题再加 --write。"
  );
  process.exit(0);
}

const dest = file.replace(/\.json$/, "") + ".repaired.json";
writeFileSync(dest, JSON.stringify(Array.isArray(raw) ? out : { ...raw, jds: out }, null, 2), "utf8");
console.log("\n写到了 " + dest + "（原文件没动）。");
console.log("导回插件：设置页的「导入备份」选这个文件。");
