/* 多端并发写的冲突检测（乐观并发控制）。
 *
 * ══════════ 它防的是什么 ══════════
 *
 * 简历/学习/刷题的写入原来全是无条件 upsert —— **最后写的赢**。
 * 而这个产品的前提就是多端：插件、手机浏览器、电脑浏览器。
 *
 * 真会丢数据的场景：手机上标了 M3「能空手讲」，电脑那个标签页是半小时前打开的，
 * 你在上面点了一下 M3 → 它拿着半小时前的旧状态往上写，手机那次标记没了，
 * **而且不报错**。刷题的错题数更明显：`nextWrong = 我读到的 + 1`，
 * 两端各自 +1，最后只涨了 1。
 *
 * 做法：读的时候记下那一行的 `updated_at`，写的时候拿它当条件。
 * 条件不匹配 → 影响 0 行 → 中间有人改过 → 返回 conflict，让界面重新读。
 *
 * ══════════ 为什么单独一个文件 ══════════
 *
 * 为了**能被测到**。原来这段逻辑写在 supabaseSource 里，
 * 而那个模块一加载就绑定了真实的 supabase 客户端 —— 没有真实云端就一行都跑不了，
 * 于是这套机制会以"写完了但从没验证过"的状态存在。
 * 这里把数据库访问收窄成下面那个只有两个方法的 `VersionedDb` 接口，
 * 测试传一个假的进去，就能构造出"另一端改过了"这种真实云端很难制造的情形。
 */

export interface VersionedWriteResult {
  ok: boolean;
  reason?: string;
  conflict?: true;
}

/** 这套机制需要数据库做的全部事情。刻意只有两个方法 —— 接口越窄，假实现越可信。 */
export interface VersionedDb {
  /** 条件更新：where user_id=uid and <idCol>=id and updated_at=expected。
   *  返回**实际被改到的行**的新 updated_at 列表（0 行就是条件没匹配上）。 */
  updateIfVersion(args: {
    table: string;
    idCol: string;
    id: string;
    uid: string;
    expectedUpdatedAt: string;
    patch: Record<string, unknown>;
  }): Promise<{ rows: { updated_at?: string }[]; error?: string }>;

  /** 无条件 upsert，返回新的 updated_at。没有已知版本时才走这条。 */
  upsertRow(args: {
    table: string;
    idCol: string;
    id: string;
    uid: string;
    patch: Record<string, unknown>;
  }): Promise<{ rows: { updated_at?: string }[]; error?: string }>;
}

export const CONFLICT_MSG =
  "云端这一行在你打开页面之后被改过了（另一台设备 / 另一个标签页 / 插件）。" +
  "已经刷新成云端的值 —— 看一眼是不是你要的，然后再操作一次。";

/** 记住"我读到的那一版"。key 是 表 + 行标识。 */
export class RowVersions {
  private map = new Map<string, string>();
  private key(table: string, id: string) {
    return table + "::" + id;
  }
  remember(table: string, id: string, updatedAt: unknown): void {
    if (typeof updatedAt === "string" && updatedAt) this.map.set(this.key(table, id), updatedAt);
  }
  get(table: string, id: string): string | undefined {
    return this.map.get(this.key(table, id));
  }
  forget(table: string, id: string): void {
    this.map.delete(this.key(table, id));
  }
  get size(): number {
    return this.map.size;
  }
}

export interface WriteArgs {
  db: VersionedDb;
  versions: RowVersions;
  table: string;
  idCol: string;
  id: string;
  uid: string;
  patch: Record<string, unknown>;
  /** 注入时间，只为测试可重复。生产不传。 */
  now?: () => string;
}

export async function writeVersioned(args: WriteArgs): Promise<VersionedWriteResult> {
  const { db, versions, table, idCol, id, uid, patch } = args;
  const now = args.now || (() => new Date().toISOString());

  /* ⚠️ updated_at **显式写**，不依赖表上的触发器。
   *
   * schema.sql 里确实有 `career_touch_updated_at` 的 BEFORE UPDATE 触发器，
   * 但没法确认已经建好的库里真的有它 —— 那份 schema 改过好几版，
   * 而已存在的库不会因为文件改了就自动跟上。
   * 而这整套检测的前提正是"每次写之后版本号会变"：
   * 触发器不在的话版本号永远不变 → 检测永远不报 → 一道从不报错的闸门。
   *
   * 显式写就和触发器在不在无关了。触发器在的话它会覆盖掉这个值
   * （BEFORE UPDATE 最后生效），而两条路径都用**读回来的实际值**刷新缓存，
   * 所以两种情况下版本号都是准的。 */
  const stamped = { ...patch, updated_at: now() };
  const expected = versions.get(table, id);

  if (expected) {
    const { rows, error } = await db.updateIfVersion({
      table,
      idCol,
      id,
      uid,
      expectedUpdatedAt: expected,
      patch: stamped,
    });
    if (error) return { ok: false, reason: error };
    if (rows.length === 0) {
      /* 冲突，或者那一行被删了（两种都要人看一眼，处理方式相同）。
         把版本号丢掉：留着它下次还会撞，而界面此时应该重新读，读的时候会记上新的。 */
      versions.forget(table, id);
      return { ok: false, reason: CONFLICT_MSG, conflict: true };
    }
    versions.remember(table, id, rows[0].updated_at);
    return { ok: true };
  }

  /* 没有已知版本（没读过这一行，或那一行原本不存在）。
     退回原来的行为，**不假装能检测** —— 这是已知边界，不是遗漏。 */
  const { rows, error } = await db.upsertRow({ table, idCol, id, uid, patch: stamped });
  if (error) return { ok: false, reason: error };
  if (rows[0]) versions.remember(table, id, rows[0].updated_at);
  return { ok: true };
}
