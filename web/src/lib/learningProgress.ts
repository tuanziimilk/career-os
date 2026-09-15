/* 学习进度这一个指标的唯一算法。
 *
 * ══════════ 为什么要为一个除法单开一个文件 ══════════
 *
 * 因为它原来在两页各算了一遍，算出两个数：
 *   · 学习页：`已标记为「能空手讲」的模块 / modules.json 里的模块总数` → 1/10
 *   · 首页：  `已标记为「能空手讲」的模块 / **数据库里有进度记录的行数**` → 1/2
 *
 * 首页那个分母是错的，而且错得有特点：**你越用它越退步** ——
 * 去标记第三个模块，分母从 2 变成 3，进度条往回走。
 *
 * 错因值得写下来：`source.getLearning()` 返回的是"状态"，
 * 它只包含**被标过的那几行**。状态那一侧永远不知道自己缺了什么，
 * 内容的总量只有内容文件知道。把"有记录的"当成"全部"是这一类 bug 的通名。
 *
 * 顺带修掉第二个、更隐蔽的差异：分子也不一样。
 * 首页原来直接数进度行，所以**一行指向已经不存在的模块**（改过 modules.json
 * 之后的残留）也会被算进去，能算出 11/10 这种数。
 * 这里统一成「只认内容里还存在的模块」。
 */

export interface ProgressRow {
  id: string;
  status: string;
}

export interface LearningProgress {
  /** 已「能空手讲」的模块数。只数内容里还存在的模块 */
  done: number;
  /** 模块总数 —— 永远来自内容，不来自进度记录 */
  total: number;
  /** done / total，total 为 0 时是 0（不是 NaN —— 它会被塞进 CSS 宽度） */
  ratio: number;
  /** 进度记录里指向已不存在模块的行数。不为 0 说明内容和状态脱节了 */
  orphanRows: number;
}

/** 算作"学完"的状态。四档里只有最后一档算 —— 「已懂」不算，
    因为这个指标的语义是"能空手讲"，那是四档循环的终点。 */
export const DONE_STATUS = "能空手讲";

export function learningProgress(
  contentModuleIds: string[],
  rows: ProgressRow[]
): LearningProgress {
  const known = new Set(contentModuleIds);
  const byId = new Map<string, string>();
  for (const r of rows || []) byId.set(r.id, r.status);

  const done = contentModuleIds.filter((id) => byId.get(id) === DONE_STATUS).length;
  const total = known.size;
  const orphanRows = (rows || []).filter((r) => !known.has(r.id)).length;

  return { done, total, ratio: total ? done / total : 0, orphanRows };
}
