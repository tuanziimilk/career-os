/* 能力自评 note ↔ 等级 互转的断言。
 *
 *     node career-web/scripts/eval-capability-note.mjs
 *
 * ⚠️ 为什么这么小的两个函数需要测：
 * `career_profile.capabilities` 存的是 `{ 组名: note }`，**等级没有单独的列** ——
 * 它是从 note 的 emoji 前缀反解出来的。所以写回时必须带上前缀。
 * 这里错一个字符，后果是**所有等级静默变成「未评估」**：不报错，
 * 只是 04 匹配分析的覆盖率变成 null（"算不出"），整页数据消失。
 * 那种 bug 最难查，而它的全部逻辑就在这两个纯函数里。
 *
 * 关键断言是**往返一致**（round-trip）：compose 之后再 split 必须拿回原样。
 * 单独测任一个方向都可能两边一起错而测不出来。
 *
 * ⚠️ 这是 career-web 侧第一个 eval 脚本，所以用和 jd-insight 那四套一样的
 * 输出格式和退出码约定（不过就 exit 1），方便以后统一挂进 build。
 * 它读 .ts 源码里的实现——通过一份手写的同构副本，理由见下面 IMPL 注释。
 */
/* ⚠️ 直接 import 那个 `.ts` —— Node 22 自带类型剥离，能直接跑。
 *
 * 第一版不是这么写的：我以为 Node 跑不了 .ts，于是写了一段正则把两个函数体
 * 从源文件里抠出来、剥掉类型标注、再 `new Function` 求值。**当场就坏了** ——
 * 剥参数类型的那条正则 `(\w+)\s*:\s*…` 把返回值对象字面量里的
 * `{ level: "", text: … }` 也当成了带类型的参数，剥成了 `{ level, text: … }`，
 * 于是 `level is not defined`。
 *
 * 这正是「手写个简化版解析器」这类做法的典型失败：它不是不工作，
 * 它是**在你以为测的是源码时，实际测的是一个被改坏的副本**。
 * 有现成的正确工具就别自己拼一个。
 */
import { composeNote, splitNote } from "../src/lib/capabilityNote.ts";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

console.log("── compose ──");
check("等级 + 正文", composeNote("🟡", "搭过检索链路") === "🟡 搭过检索链路",
  JSON.stringify(composeNote("🟡", "搭过检索链路")));
check("等级 + 空正文 → 只留等级（等级本身就是信息）",
  composeNote("🔴", "") === "🔴", JSON.stringify(composeNote("🔴", "")));
check("等级 + 全空格正文 → 只留等级",
  composeNote("🔴", "   ") === "🔴");
check("无等级 → 原样返回正文", composeNote("", "历史遗留的无前缀数据") === "历史遗留的无前缀数据");
check("无等级 + 空正文 → 空串（保存时会被过滤掉）", composeNote("", "") === "");
check("正文首尾空格被裁掉", composeNote("🟢", "  做过  ") === "🟢 做过");

console.log("\n── split ──");
check("拆出等级和正文", JSON.stringify(splitNote("🟡 搭过检索链路"))
  === JSON.stringify({ level: "🟡", text: "搭过检索链路" }));
check("只有等级", JSON.stringify(splitNote("🔴")) === JSON.stringify({ level: "🔴", text: "" }));
check("等级后多个空格也认", splitNote("🟢    做过").text === "做过");
check("无前缀 → 等级为空、正文原样",
  JSON.stringify(splitNote("没有前缀")) === JSON.stringify({ level: "", text: "没有前缀" }));
check("空串不炸", JSON.stringify(splitNote("")) === JSON.stringify({ level: "", text: "" }));
check("null 不炸", JSON.stringify(splitNote(null)) === JSON.stringify({ level: "", text: "" }));
/* ⚠️ emoji 出现在中间不算等级 —— 否则「用 🟢 标记已完成的项」这种描述
   会被误当成等级前缀，把正文吃掉一截。 */
check("emoji 在中间不算等级",
  splitNote("用 🟢 标记已完成").level === "", JSON.stringify(splitNote("用 🟢 标记已完成")));

console.log("\n── 往返一致（最关键的一组）──");
/* 单独测任一方向都可能"两边一起错"而测不出来。往返才钉得住。 */
const CASES = [
  ["🟢", "主导过 内部后台系统 重构，PRD + 字段级规格"],
  ["🟡", "搭过知识库检索链路，重排这块没深入"],
  ["🔴", "空白"],
  ["🔴", ""],
  ["", "无前缀的历史数据"],
  ["🟢", "含 emoji 的描述：用 🟡 标过的那些"],
  ["🟡", "含 / 斜杠 和「中文引号」以及 (括号)"],
];
for (const [lv, tx] of CASES) {
  const note = composeNote(lv, tx);
  const back = splitNote(note);
  const same = back.level === lv && back.text === tx.trim();
  check(`往返：${lv || "（无等级）"} + ${JSON.stringify(tx.slice(0, 18))}`, same,
    same ? "" : `note=${JSON.stringify(note)} → ${JSON.stringify(back)}`);
}

console.log("\n── 和 supabaseSource 的反解口径一致 ──");
/* getCapabilities() 用 note.match(/^(🟢|🟡|🔴)/) 反解等级。
   两边口径不一致会出现"读出来是 🟡、编辑器里显示未评估"这种撕裂。 */
const SOURCE_RE = /^(🟢|🟡|🔴)/;
for (const [lv, tx] of CASES) {
  const note = composeNote(lv, tx);
  const theirs = note.match(SOURCE_RE)?.[1] || "";
  check(`口径一致：${JSON.stringify(note.slice(0, 20))}`, theirs === splitNote(note).level,
    `supabaseSource=${JSON.stringify(theirs)} vs splitNote=${JSON.stringify(splitNote(note).level)}`);
}

console.log("");
if (fail) {
  console.log("!! %d 条断言不过", fail);
  process.exit(1);
}
console.log("全部断言通过");
