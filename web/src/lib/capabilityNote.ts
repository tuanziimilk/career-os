/* 能力自评的 note ↔ 等级 互转。
 *
 * ⚠️ 为什么这两个函数值得单独一个文件 + 一套断言：
 *
 * `career_profile.capabilities` 存的是 `{ 组名: note }`，而**等级没有单独的列** ——
 * 它是从 note 的 emoji 前缀反解出来的（`supabaseSource.getCapabilities()` 里
 * `note.match(/^(🟢|🟡|🔴)/)`）。
 *
 * 也就是说：写回时**必须带上前缀**。这里错一个字符的后果是
 * **所有等级静默变成「未评估」** —— 而 `match.ts` 的覆盖率分母只算已评估的项，
 * 于是 04 匹配分析会返回 `null`（"算不出"）而不是报错。
 * 一个不报错、只是让整页数据消失的 bug，最难查。
 *
 * 原来这两个函数写在 Calibration.tsx 里。抽出来是为了能被测试直接 import ——
 * 页面组件测不了，而这两个是纯函数。
 */
import type { CapabilityLevel } from "./types";

/**
 * 等级 + 正文 → 存进 jsonb 的 note。
 *
 * 三种情况：
 *   有等级 + 有正文 → "🟡 搭过检索链路，重排没深入"
 *   有等级 + 无正文 → "🟡"（等级本身就是信息，不该因为没写描述就丢掉）
 *   无等级          → 原样返回正文（可能是历史遗留的无前缀数据）
 */
export function composeNote(level: CapabilityLevel, text: string): string {
  const t = text.trim();
  if (!level) return t;
  return t ? `${level} ${t}` : level;
}

/**
 * 存好的 note → 等级 + 正文。
 *
 * ⚠️ 必须和 `supabaseSource.getCapabilities()` 里那个正则**同口径**，
 * 否则会出现"读出来是 🟡、编辑器里显示未评估"这种撕裂。
 */
export function splitNote(note: string): { level: CapabilityLevel; text: string } {
  const m = String(note ?? "").match(/^(🟢|🟡|🔴)\s*/);
  if (!m) return { level: "", text: String(note ?? "") };
  return { level: m[1] as CapabilityLevel, text: String(note).slice(m[0].length) };
}
