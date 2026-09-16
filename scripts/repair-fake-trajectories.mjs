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

import { STATUS_CYCLE, isTerminal } from "../extension/lib/pipeline.js";

/** 这一档在漏斗里的位置。认不出的（空串、"采集"）返回 -1。 */
function rank(status) {
  const i = STATUS_CYCLE.indexOf(status || "");
  return status && i > 0 ? i : -1;
}

/** 轨迹里有没有**倒退**：offer 之后又回到「想投」这种。
 *
 * 真实的求职流程只会往前走，或者走到终止态停住。倒退一次都不该有。
 * 所以只要出现倒退，这条轨迹**整条都不可信** —— 不是"其中几条是假的"，
 * 是"这根本不是一段经历，是有人在界面上来回点"。
 */
function hasRegression(hist) {
  let top = -1;
  for (const h of hist) {
    const r = rank(h.status);
    if (r < 0) continue;
    if (r < top) return true;
    top = r;
  }
  return false;
}

let touched = 0;
const out = recs.map((r) => {
  const hist = r.statusHistory || [];
  if (hist.length < 2) return r;

  let kept;
  let why;

  if (hasRegression(hist)) {
    /* 规则一（优先）：轨迹倒退 → 整条重置为「首条 + 当前状态」。
       首条留着是因为它是采集时刻，算得出"这条躺了多久"；
       当前状态如果非空就补一条，否则这条记录就回到"没标记过"。 */
    why = "轨迹有倒退（offer 之后又回到早期档），整条不可信";
    kept = [hist[0]];
    if (r.status && r.status !== hist[0].status) {
      kept.push({ status: r.status, at: hist[hist.length - 1].at });
    }
  } else {
    /* 规则二：连点。相邻两档间隔 < GAP_MS 的判为同一串点击，段内只留段尾。 */
    const drop = hist.map((h, i) => {
      if (i === 0 || i === hist.length - 1) return false;
      const t = Date.parse(h.at || "");
      const tn = Date.parse(hist[i + 1]?.at || "");
      if (!Number.isFinite(t) || !Number.isFinite(tn)) return false;
      return tn - t < GAP_MS;
    });
    kept = hist.filter((_, i) => !drop[i]);
    why = "相邻档位间隔不到 " + GAP_MS / 1000 + " 秒，判为连点";
    if (kept.length === hist.length) return r;
  }

  touched++;
  const label = (r.company || "?") + " / " + (r.title || "?").split(String.fromCharCode(10))[0].slice(0, 24);
  console.log("");
  console.log(label);
  console.log("  判据  " + why);
  console.log("  当前 status = " + JSON.stringify(r.status || ""));
  console.log("  原  " + hist.map(fmt).join(" → "));
  console.log("  改  " + kept.map(fmt).join(" → "));
  console.log("  " + hist.length + " 条 → " + kept.length + " 条");
  return { ...r, statusHistory: kept };
});

function fmt(h) {
  return h.status || "（空）";
}

console.log(
  "\n共 " + recs.length + " 条记录，" + touched + " 条的轨迹不可信。" +
    (touched ? "" : "（干净，不用修）")
);

if (!touched) process.exit(0);

if (!doWrite) {
  console.log(
    "\n只是看看，没动任何文件。\n" +
      "上面每一条都自己核一遍。两条判据都会误伤：" +
      "「倒退」会冤枉真的从 offer 谈崩回到复面的流程，「连点」会冤枉面完当场给 offer 的。" +
      "确认没问题再加 --write。"
  );
  process.exit(0);
}

const dest = file.replace(/\.json$/, "") + ".repaired.json";
writeFileSync(dest, JSON.stringify(Array.isArray(raw) ? out : { ...raw, jds: out }, null, 2), "utf8");
console.log("\n写到了 " + dest + "（原文件没动）。");
console.log("导回插件：打开扩展的**设置页** → 最下面「本地数据」那一节 → 「恢复备份…」选这个文件。");
