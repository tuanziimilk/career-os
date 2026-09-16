/* 投递状态模型与挂掉归因的断言。
 *
 *     node jd-insight/scripts/eval-status-model.mjs
 *
 * ══════════ 核心断言只有一条，其余都围着它 ══════════
 *
 *   **把一条从没投过的记录标成「已挂」，不能在状态轨迹里留下
 *     「已投 / 进面 / 复面 / offer」的痕迹。**
 *
 * 这个 bug 和 eval-jd-merge 那条是同一类，但更难发现：
 *   · 它不报错，轨迹看起来完全正常（每一档都有合法时间戳）
 *   · 它的触发条件就是**正常使用**——旧交互里 status 是一个在八档里
 *     循环点击的 chip，要落到「已拒」必须点 7 下，每一下 pushStatus
 *     都追加一条历史
 *   · 于是漏斗会说这条记录 applied=1、offer=1。实测过，不是推演
 *   · 损坏的是时间戳类数据，`pipeline.js` 文件头写着"一旦没记就永远补不回来"
 *
 * ⚠️ 先对着旧实现（STATUS_CYCLE 含终止态 + 单 chip 循环）跑过，确认第 1 组是红的，
 * 再改的代码。否则只能证明这些断言对当前实现是绿的。
 */
import {
  MAIN_CYCLE,
  STATUS_CYCLE,
  TERMINAL,
  FAIL_GROUPS,
  FAIL_REASONS,
  FAIL_BUCKETS,
  countsAsFailure,
  endedAtStage,
  failBreakdown,
  isTerminal,
  pushStatus,
} from "../extension/lib/pipeline.js";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}
function group(t) {
  console.log("\n" + t);
}

/* ─────────────────────────────────────────── 1. 主线不含终止态（核心） */
group("1. 主线循环不能把人拖着走过整条漏斗");

check(
  "MAIN_CYCLE 里没有任何终止态",
  MAIN_CYCLE.every((s) => !isTerminal(s)),
  JSON.stringify(MAIN_CYCLE)
);
check(
  "MAIN_CYCLE 停在 offer",
  MAIN_CYCLE[MAIN_CYCLE.length - 1] === "offer",
  MAIN_CYCLE[MAIN_CYCLE.length - 1]
);
check(
  "MAIN_CYCLE 是 STATUS_CYCLE 去掉终止态的结果（两份常量不能各飘各的）",
  JSON.stringify(MAIN_CYCLE) === JSON.stringify(STATUS_CYCLE.filter((s) => !isTerminal(s)))
);

/* 模拟旧交互：从空状态循环点到「已拒」，看轨迹里混进了什么。
   这一段就是当初把 bug 钉死的那个复现，留在这里当回归。 */
function cycleTo(target, cycle) {
  let rec = { key: "k", status: "", statusHistory: [{ status: "采集", ts: "T0" }] };
  for (let i = 0; i < 20; i++) {
    if (rec.status === target) break;
    const idx = cycle.indexOf(rec.status);
    const next = cycle[(idx + 1) % cycle.length];
    rec = pushStatus(rec, next);
  }
  return rec;
}
const oldWay = cycleTo("已拒", STATUS_CYCLE);
check(
  "【复现旧 bug】旧循环点到「已拒」会伪造出 offer 轨迹",
  oldWay.statusHistory.some((h) => h.status === "offer"),
  "轨迹：" + oldWay.statusHistory.map((h) => h.status).join(" → ")
);
check(
  "新的主线循环永远走不到终止态，走满一圈也不会经过 offer 之后的档",
  cycleTo("已拒", MAIN_CYCLE).statusHistory.filter((h) => isTerminal(h.status)).length === 0
);

/* 新交互的写法：一步到位。「挂了」→ 选归因 → 补阶段 + 落终止态。 */
let once = { key: "k", status: "", statusHistory: [{ status: "采集", ts: "T0" }] };
once = pushStatus(once, "已挂");
check(
  "一步标「已挂」，轨迹里只多了一条",
  once.statusHistory.length === 2 && once.statusHistory[1].status === "已挂",
  once.statusHistory.map((h) => h.status).join(" → ")
);
check(
  "而且不含任何漏斗中间档",
  !once.statusHistory.some((h) => ["已投", "进面", "复面", "offer"].includes(h.status))
);

/* ─────────────────────────────────────────── 2. endedAtStage */
group("2. endedAtStage：挂之前停在哪");

check(
  "取最后一个非终止态",
  endedAtStage({
    status: "已拒",
    statusHistory: [
      { status: "想投" },
      { status: "已投" },
      { status: "进面" },
      { status: "已挂" },
      { status: "已拒" },
    ],
  }) === "进面"
);
check("没有历史时拿当前状态兜底", endedAtStage({ status: "已投", statusHistory: [] }) === "已投");
check(
  "当前状态本身就是终止态、且没有历史 → 返回空（不能瞎猜一个阶段出来）",
  endedAtStage({ status: "已挂", statusHistory: [] }) === ""
);
check("字段整个缺失也不炸", endedAtStage({}) === "" && endedAtStage(null) === "");

/* ⚠️ 这一条断言的是**已知的洞**，不是期望行为。
   没逐档标记时归因会系统性偏向早期阶段，所以界面必须允许一键改。
   把它写成断言是为了：哪天有人"修好"了推断，这里会红，提醒去看界面那一侧
   是不是还留着那个下拉框。 */
check(
  "【已知洞】只标过「已投」就挂了的记录，会被推成挂在已投（实际可能面过）",
  endedAtStage({ status: "已挂", statusHistory: [{ status: "已投" }, { status: "已挂" }] }) ===
    "已投"
);

/* ─────────────────────────────────────────── 3. 归因分组 */
group("3. 归因分组：外部因素不能算进我的失败率");

check("每条归因的 group 都在 FAIL_GROUPS 里", FAIL_REASONS.every((r) => FAIL_GROUPS.some((g) => g.id === r.group)));
check("归因 id 不重复", new Set(FAIL_BUCKETS).size === FAIL_BUCKETS.length);
check("FAIL_BUCKETS 由 FAIL_REASONS 派生，不是第三份手写清单", FAIL_BUCKETS.length === FAIL_REASONS.length);

check("「岗位没了」不算我的失败", countsAsFailure("岗位没了") === false);
check("「我拒了 offer」不算我的失败", countsAsFailure("我拒了 offer") === false);
check("「还不知道」不算我的失败", countsAsFailure("还不知道") === false);
check("「技术被问穿」算", countsAsFailure("技术被问穿") === true);
check(
  "自由填写的归因保守算进失败（宁可高估自己的问题，也不要把它藏进外部因素）",
  countsAsFailure("我瞎写的一条") === true
);

/* 判据是分界线本身，不是修辞。这两个桶不给判据就会互相污染，
   最后"该补技术还是该练表达"的统计是假的。 */
for (const id of ["技术被问穿", "讲不明白"]) {
  const r = FAIL_REASONS.find((x) => x.id === id);
  check("「" + id + "」带判据", !!(r && r.hint && r.hint.trim()), r ? r.hint : "（找不到这条）");
}
check(
  "有一个显式的「还不知道」——不写归因不该是个隐形状态",
  FAIL_REASONS.some((r) => r.id === "还不知道")
);

/* ─────────────────────────────────────────── 4. failBreakdown */
group("4. failBreakdown：分组统计");

const recs = [
  { status: "已拒", failReason: "技术被问穿" },
  { status: "已挂", failReason: "讲不明白" },
  { status: "已挂", failReason: "岗位没了" },
  { status: "已挂" }, // 没归因
  { status: "进面", failReason: "技术被问穿" }, // 没结束，不该被算进去
];
const b = failBreakdown(recs);
check("只统计终止态的记录", b.total === 4, "total=" + b.total);
check("failures 只算「可以改的」那一组", b.failures === 2, "failures=" + b.failures);
check("notMyFault = 外部 + 我的选择", b.notMyFault === 1, "notMyFault=" + b.notMyFault);
check("没写归因的落进 unknown", b.unknown === 1, "unknown=" + b.unknown);
check("三组加起来等于 total", b.failures + b.notMyFault + b.unknown === b.total);
check(
  "没写归因的不另立「未归因」桶，直接并进「还不知道」",
  b.rows.some(([k]) => k === "还不知道") && !b.rows.some(([k]) => k === "未归因")
);
check("rows 按数量降序", b.rows.every((row, i) => i === 0 || b.rows[i - 1][1] >= row[1]));
check("空输入不炸", failBreakdown([]).total === 0 && failBreakdown(null).total === 0);

check("TERMINAL 仍是那两个", JSON.stringify(TERMINAL) === JSON.stringify(["已挂", "已拒"]));

console.log("\n" + (fail ? "✗ " + fail + " 条不过" : "✓ 全过"));
process.exit(fail ? 1 : 0);
