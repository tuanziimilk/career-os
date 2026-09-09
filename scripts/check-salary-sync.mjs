/* 校验 career-web 和扩展的薪资解析是同一份代码。
 *
 * 为什么需要这个：薪资解析是"同一个字符串在两端必须得到同一个结果"的地方。
 * 扩展是零构建的纯 JS，工作台是 Vite+TS——两边没有共享包的机制，
 * 所以采用「一份权威 + 原样复制 + 机器校验」而不是「各写一份」。
 * 各写一份的结局是某天 25～40K（全角波浪号）在一端能解析、另一端不能，
 * 而这种不一致只会在数据对不上时才被发现，极难定位。
 *
 * 用法：npm run check:salary
 * 改规则的流程：改扩展那份 → 重新复制过来 → 跑这个脚本确认一致。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MINE = resolve(here, "../src/lib/salary.js");
const SOURCE = resolve(here, "../../jd-insight/extension/lib/salary.js");

function read(p) {
  try {
    // 统一行尾再比，免得 Windows 的 CRLF 造成假警报
    return readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  } catch (e) {
    console.error(`✗ 读不到 ${p}\n  ${e.message}`);
    process.exit(2);
  }
}

const mine = read(MINE);
const source = read(SOURCE);

if (mine === source) {
  console.log("✓ 薪资解析两端一致（src/lib/salary.js === jd-insight/extension/lib/salary.js）");
  process.exit(0);
}

console.error("✗ 薪资解析两端不一致！");
const a = source.split("\n");
const b = mine.split("\n");
const max = Math.max(a.length, b.length);
let shown = 0;
for (let i = 0; i < max && shown < 12; i++) {
  if (a[i] !== b[i]) {
    console.error(`  第 ${i + 1} 行`);
    console.error(`    扩展:   ${a[i] === undefined ? "（无此行）" : a[i]}`);
    console.error(`    工作台: ${b[i] === undefined ? "（无此行）" : b[i]}`);
    shown++;
  }
}
console.error(
  "\n  扩展那份是权威。修法：\n" +
    "    cp ../jd-insight/extension/lib/salary.js src/lib/salary.js"
);
process.exit(1);
