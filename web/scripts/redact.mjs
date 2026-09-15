/* 脱敏词表的加载器。词表本身在 redact.local.mjs（不进版本库），
 * 结构与「什么该藏、什么不必藏」的判据写在 redact.example.mjs。
 *
 * 三个消费方都从这里拿：
 *   import-content.mjs   替换规则（写产物，最不能出错）
 *   leaks.mjs            对产物扫「替换有没有漏」
 *   check-diagrams.mjs   图源那条路径，只查最硬的几个词
 *
 * ⚠️ **缺文件时的行为是这个模块最要紧的部分，别改成静默跳过。**
 *   判据是知识库在不在，理由见 redact.example.mjs 文件头。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.join(HERE, "redact.local.mjs");

/* 知识库在不在 = 这台机器上有没有需要脱敏的原始素材。
   路径判断和 import-content.mjs 的 KB_ROOT 保持一致。 */
const KB_ROOT = [
  path.resolve(HERE, "../../career-knowledgebase"),
  path.resolve(HERE, "../../../career-knowledgebase"),
].find((p) => fs.existsSync(p));

export const hasKnowledgeBase = Boolean(KB_ROOT);
export const hasLocalList = fs.existsSync(LOCAL);

/** @type {{match: RegExp, replace: string, reason: string, hard?: boolean}[]} */
export let IDENTIFIERS = [];
if (hasLocalList) {
  IDENTIFIERS = (await import("./redact.local.mjs")).IDENTIFIERS || [];
}

/**
 * 每个消费方在用词表之前先调一次。
 *
 * - 本地词表在 → 直接返回
 * - 不在，但知识库在（作者本人的机器）→ **报错退出**。
 *   这台机器上有原始素材，跑没有词表的脱敏等于假装做过
 * - 两个都不在（别人克隆的仓库）→ 打印「未执行」并继续。
 *   注意措辞：说的是**没执行**，不是**通过了**
 *
 * @param {string} who 调用方名字，出现在报错里
 * @param {{fatal?: boolean}} [opts] fatal=true 时无论知识库在不在都必须有词表
 */
export function requireRedactList(who, opts = {}) {
  if (hasLocalList) return true;

  const how =
    "  修：cp web/scripts/redact.example.mjs web/scripts/redact.local.mjs\n" +
    "     然后把占位换成真实词条。这个文件已在 .gitignore 里，不会被提交。";

  if (opts.fatal || hasKnowledgeBase) {
    console.error(`\n!! ${who}：找不到 web/scripts/redact.local.mjs，脱敏词表是空的。`);
    if (hasKnowledgeBase) {
      console.error("   而这台机器上**有知识库**，也就是说有需要脱敏的原始素材 ——");
      console.error("   带着空词表跑下去，等于假装脱敏过。");
    } else {
      console.error("   这一步会写产物，没有词表就不能跑。");
    }
    console.error(how + "\n");
    process.exit(1);
  }

  console.log(`  （${who}：本地词表不存在，**身份类断言未执行**。`);
  console.log("    这台机器上没有知识库，所以没有需要脱敏的原始素材；");
  console.log("    通用断言照常跑。要跑完整的，见 redact.example.mjs。）");
  return false;
}

/** 给 import-content.mjs 的替换规则：[正则, 替换词][] */
export function redactRules() {
  return IDENTIFIERS.map((i) => [i.match, i.replace]);
}

/**
 * 给 leaks.mjs / check-diagrams.mjs 的检出词：[正则, 原因][]
 *
 * ⚠️ 这里必须**去掉 /g**。带 g 的正则用 .test() 会记住 lastIndex，
 *   对同一个正则连续 test 会交替返回 true/false —— 那是漏报，
 *   而且只在扫到第二条内容时才发作，最难查的那种。
 *
 * @param {{hardOnly?: boolean}} [opts]
 */
export function leakWords(opts = {}) {
  return IDENTIFIERS.filter((i) => (opts.hardOnly ? i.hard : true)).map((i) => [
    new RegExp(i.match.source, i.match.flags.replace(/g/g, "")),
    i.reason,
  ]);
}

/**
 * 给 eval-leaks.mjs 的 MUST_FLAG 用例：[位置, 真实泄漏文本][]
 *
 * ⚠️ 为什么这个也要藏：证明词表有效的断言，**必须拿真实泄漏文本去撞**。
 *   那些文本里就带着要脱敏的词 —— 于是「测试」成了这层洋葱的第三片。
 *   先是规则（import-content），再是检出词表（leaks），最后是证明词表有效的样本。
 *   三层都得挪。
 */
export function leakSamples() {
  return IDENTIFIERS.filter((i) => i.sample).map((i) => i.sample);
}
