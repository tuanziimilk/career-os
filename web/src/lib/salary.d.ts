/* salary.js 的类型声明。
 *
 * salary.js 是从 jd-insight/extension/lib/salary.js **原样复制**过来的纯 JS，
 * 不做 TS 移植——移植就意味着两套解析规则，而这个函数是"同一个字符串在
 * 扩展和工作台必须解析出同一个结果"的地方，漂移了会很难查。
 *
 * 一致性由 `npm run check:salary` 保证：两份文件不一致就报错。
 * 改规则时改扩展那份，然后重新复制。
 */

export interface ParsedSalary {
  /** 原始字符串，永远保留 */
  raw: string;
  /** 是否成功解析出数字。false 时只有 raw 和 note 有意义 */
  parsed: boolean;
  /** 解析失败的原因，人话 */
  note?: string;
  /** 原始口径。min/max 已经折算成月薪 */
  period?: "month" | "day" | "year";
  /** 月薪下限（元） */
  min?: number;
  /** 月薪上限（元） */
  max?: number;
  /** 13薪/15薪。没写就是 undefined，不默认成 12 */
  months?: number;
  /** 年薪 = min * (months ?? 12) */
  annualMin?: number;
  annualMax?: number;
}

export function parseSalary(text: string | null | undefined): ParsedSalary;
export function findSalaryCandidates(text: string | null | undefined): string[];
export function formatSalary(sal: ParsedSalary | null | undefined): string;
