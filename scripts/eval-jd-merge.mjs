/* 采集去重键与合并规则的断言。
 *
 *     node jd-insight/scripts/eval-jd-merge.mjs
 *
 * ══════════ 核心断言只有一条，其余都围着它 ══════════
 *
 *   **一条已经标成「已投」的记录，在同一个岗位页面再按一次 Alt+S 之后，
 *     投递状态和状态轨迹必须原样还在。**
 *
 * 这个 bug 的全部特征都指向"必须用测试钉住"：
 *   · 它不报错（toast 还显示「已更新 ·」）
 *   · 它的触发条件（重复采到已存岗位）在 100 条规模下是必然事件
 *   · 它损坏的是时间戳类数据，`pipeline.js` 文件头写着"一旦没记就永远补不回来"
 *   · 而且云端那份还活着 —— 所以症状不是"数据没了"，是**两个界面各说各话**
 *
 * ⚠️ 写的时候先对着旧实现（`jds[i] = rec`）跑过，确认它是红的，再改的代码。
 * 否则只能证明这些断言对当前实现是绿的，不能证明它们测到了那个 bug。
 */
import {
  mergeJd,
  jdKey,
  sitePrefix,
  isFallbackKey,
  LOCAL_ONLY_FIELDS,
  SALARY_FIELDS,
  mergeBackup,
} from "../extension/lib/jdMerge.js";

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const NOW = "2026-09-14T10:00:00.000Z";

/** 一条"已经用了一阵子"的本地记录：标过投递、有轨迹、手填过薪资、点过意向。 */
function existing() {
  return {
    jobId: "12345678",
    key: "boss:12345678",
    url: "https://www.zhipin.com/job_detail/12345678.html",
    title: "AI 产品经理",
    company: "甲公司",
    tagline: "上海 · 3-5年 · 本科",
    salary: "30-50K·15薪",
    salarySource: "手填",
    salaryParsed: { min: 30000, max: 50000, months: 15 },
    salaryBlocked: false,
    salaryPending: false,
    body: "旧正文",
    pageText: "旧页面文本",
    site: "zhipin.com",
    ts: "2026-09-01T08:00:00.000Z",
    // ── 以下全部来自弹窗操作，extract() 永远不产出 ──
    status: "已投",
    statusHistory: [
      { status: "想投", at: "2026-09-01T09:00:00.000Z" },
      { status: "已投", at: "2026-09-03T09:00:00.000Z" },
    ],
    intent: "🔥",
    failReason: "",
  };
}

/** 同一个岗位页面再抓一次，extract() 会产出的东西（注意：没有任何本地流转字段）。 */
function freshExtract(over = {}) {
  return {
    jobId: "12345678",
    key: "boss:12345678",
    url: "https://www.zhipin.com/job_detail/12345678.html",
    title: "AI 产品经理（急招）", // 页面上标题改了
    company: "甲公司",
    tagline: "上海 · 3-5年 · 本科",
    salary: "25-45K·14薪", // 页面现在抓到的
    salarySource: "页面标题",
    salaryParsed: { min: 25000, max: 45000, months: 14 },
    salaryBlocked: false,
    body: "新正文，更长了",
    pageText: "新页面文本",
    site: "zhipin.com",
    ts: "2026-09-14T10:00:00.000Z", // 这次采集的时间
    ...over,
  };
}

console.log("── ⭐ 核心：重存不许丢投递历史 ──");
{
  const m = mergeJd(existing(), freshExtract(), NOW);
  check("status 还在", m.status === "已投", String(m.status));
  check("statusHistory 还在且是两条", (m.statusHistory || []).length === 2,
    JSON.stringify(m.statusHistory));
  /* ⚠️ 这里刻意用可选链而不是直接 `m.statusHistory[0].at`。
     不是为了好看：拿旧实现（整条替换）跑这个脚本时 statusHistory 是 undefined，
     直接下标会**抛异常中断整个脚本** —— 于是你只看到前两条 FAIL，
     后面二十多条根本没跑。一个"红的时候只报一部分"的测试，
     会让人以为问题比实际小。 */
  const hist = m.statusHistory || [];
  check(
    "轨迹的时间戳逐条不变（这是永远补不回来的那部分）",
    hist[0]?.at === "2026-09-01T09:00:00.000Z" && hist[1]?.at === "2026-09-03T09:00:00.000Z",
    JSON.stringify(hist.map((h) => h.at))
  );
  check("intent 还在（弹窗里手点的意向）", m.intent === "🔥", String(m.intent));
  check("failReason 键还在", "failReason" in m);
}

console.log("\n── 页面上真的变了的东西，要更新 ──");
/* 反面断言：如果把"什么都保留旧的"当成解法，这一组会红。
   重存的**目的**就是拿到页面上的新内容。 */
{
  const m = mergeJd(existing(), freshExtract(), NOW);
  check("标题更新成页面上的新标题", m.title === "AI 产品经理（急招）", m.title);
  check("正文更新", m.body === "新正文，更长了");
  check("pageText 更新", m.pageText === "新页面文本");
}

console.log("\n── 采集时间保留首次，另记 updatedAt ──");
/* ts 在漏斗里被当成"这条什么时候进的库"（pipeline.js:126 没有轨迹时拿它当起点）。
   每次重存都刷新的话，一个采了两周投了一周的岗位会显示成"今天刚采的"。 */
{
  const m = mergeJd(existing(), freshExtract(), NOW);
  check("ts 还是首次采集时间", m.ts === "2026-09-01T08:00:00.000Z", m.ts);
  check("updatedAt 记的是这次", m.updatedAt === NOW, m.updatedAt);
}

console.log("\n── 薪资四件套必须同进同退 ──");
{
  /* 手填过就不许被页面抓的覆盖 —— 人填的比抓的可信，那是它存在的理由。 */
  const m = mergeJd(existing(), freshExtract(), NOW);
  check("手填的薪资保住了", m.salary === "30-50K·15薪", m.salary);
  check("salarySource 跟着保住（不能变成「页面标题」）", m.salarySource === "手填", m.salarySource);
  check("salaryParsed 跟着保住", m.salaryParsed && m.salaryParsed.months === 15,
    JSON.stringify(m.salaryParsed));
  /* ⚠️ 这条是这一组的重点：只保 salary 会造出
     「salary 是手填值、salarySource 是空、salaryParsed 是 null」这种
     内部对不上的记录。它不报错，只是以后按薪资排序时悄悄排不进去。 */
  check(
    "四个字段内部一致（不许出现手填的值配着抓来的来源）",
    (m.salary === "30-50K·15薪") === (m.salarySource === "手填") &&
      m.salaryParsed.min === 30000
  );
}
{
  /* 没手填过的：页面抓到什么就用什么，这才是重存的意义 */
  const old = { ...existing(), salarySource: "页面标题", salary: "20-30K", salaryParsed: null };
  const m = mergeJd(old, freshExtract(), NOW);
  check("没手填过 → 用页面这次抓到的", m.salary === "25-45K·14薪", m.salary);
  check("来源也跟着更新", m.salarySource === "页面标题");
  check("salaryParsed 跟着更新", m.salaryParsed && m.salaryParsed.months === 14);
}
{
  /* 这次没抓到（反爬挡住）：不能因为这次没抓到就把上次补好的清空 */
  const old = { ...existing(), salarySource: "页面标题", salary: "20-30K" };
  const m = mergeJd(old, freshExtract({ salary: "", salaryBlocked: true, salaryParsed: null }), NOW);
  check("这次被反爬挡住 → 保留上次的值", m.salary === "20-30K", m.salary);
  check("salaryBlocked 不许被这次的 true 污染掉旧状态", m.salaryBlocked === false,
    String(m.salaryBlocked));
}
{
  /* salaryPending 是本地标记：弹窗补完会置 false，重存不许把它翻回 true */
  const old = { ...existing(), salaryPending: false };
  const m = mergeJd(old, freshExtract({ salaryBlocked: true }), NOW);
  check("salaryPending 保留本地的值", m.salaryPending === false, String(m.salaryPending));
}

console.log("\n── 新字段漏登记的防线 ──");
/* ⚠️ 这条盯的是"以后有人加了新的本地字段但忘了加进 LOCAL_ONLY_FIELDS"。
   那种遗漏的表现是"那个字段每次重存就没了"，而且不报错。
   这里测不到具体哪个字段被漏，但能测到**清单本身没被架空**。 */
{
  const old = { ...existing(), 未来某个本地字段: "别丢我" };
  const m = mergeJd(old, freshExtract(), NOW);
  check(
    "extract 不产出的字段默认被保留（因为是 {...old, ...rec}）",
    m["未来某个本地字段"] === "别丢我"
  );
  check("LOCAL_ONLY_FIELDS 非空且包含轨迹", LOCAL_ONLY_FIELDS.includes("statusHistory"));
  check("SALARY_FIELDS 是四个", SALARY_FIELDS.length === 4, SALARY_FIELDS.join(","));
}

console.log("\n── 不改入参（调用方拿旧对象做过比较）──");
{
  const old = existing();
  const rec = freshExtract();
  const snapOld = JSON.stringify(old);
  const snapRec = JSON.stringify(rec);
  mergeJd(old, rec, NOW);
  check("old 没被改", JSON.stringify(old) === snapOld);
  check("rec 没被改", JSON.stringify(rec) === snapRec);
}

console.log("\n── 边界 ──");
{
  check("old 为空时不炸（等价于插入）", mergeJd(null, freshExtract(), NOW).title.length > 0);
  check("rec 为空时不炸", mergeJd(existing(), null, NOW).status === "已投");
  const m = mergeJd({}, freshExtract(), NOW);
  check("空 old：不会凭空造出 status 键", !("status" in m), JSON.stringify(Object.keys(m).slice(-3)));
  check("空 old：ts 用这次的", m.ts === "2026-09-14T10:00:00.000Z", m.ts);
}

console.log("\n── 键：站点前缀 ──");
check("BOSS", jdKey("www.zhipin.com", "12345678", "") === "boss:12345678",
  jdKey("www.zhipin.com", "12345678", ""));
check("猎聘", jdKey("m.liepin.com", "abc", "") === "liepin:abc");
check("智联", jdKey("zhaopin.com", "x1", "") === "zhaopin:x1");
check("没登记的站点用 hostname，不用通用前缀", jdKey("foo.example.com", "9", "") === "foo.example.com:9",
  jdKey("foo.example.com", "9", ""));
/* ⚠️ 前缀存在的全部理由：两个站的 id 空间没有理由不撞。
   所以这一条是它的验收 —— 同一个 id 在两个站必须是两个键。 */
check(
  "同一个 id 在两个站是两个不同的键",
  jdKey("zhipin.com", "1001", "") !== jdKey("liepin.com", "1001", "")
);
check("www. 前缀不影响", jdKey("www.zhipin.com", "1", "") === jdKey("zhipin.com", "1", ""));
check("sitePrefix 认子域名", sitePrefix("m.zhipin.com") === "boss");

console.log("\n── 键：jobId 取不到时的降级 ──");
{
  const k = jdKey("www.zhipin.com", "", "https://www.zhipin.com/web/geek/job?query=ai&page=2");
  check("退回 URL 并去掉 query", k === "https://www.zhipin.com/web/geek/job", k);
  /* ⚠️ 这就是 v1.0 那个致命 bug 的形状：新版列表页所有岗位共享同一个 URL。
     所以它必须能被识别出来，调用方才能警告。 */
  check("能认出这是降级键", isFallbackKey(k) === true);
  check("正常键不会被误判成降级", isFallbackKey("boss:12345678") === false);
  check("空白 jobId 也算取不到", jdKey("zhipin.com", "   ", "https://a.com/b") === "https://a.com/b");
  check("null jobId 不炸", typeof jdKey("zhipin.com", null, "https://a.com/b") === "string");
}

console.log("\n── 降级键下，两个岗位会撞成同一条（这正是要警告的原因）──");
{
  const url = "https://www.zhipin.com/web/geek/job";
  check(
    "同一列表页的两个岗位拿到同一个键",
    jdKey("zhipin.com", "", url) === jdKey("zhipin.com", "", url)
  );
}

console.log("");
if (fail) {
  console.log(`!! ${fail} 条断言不过`);
  process.exit(1);
}
console.log("全部断言通过");

/* ─────────────────────────────────────────── 恢复备份 */
console.log("");
console.log("恢复备份：mergeBackup");

/* ⚠️ 这个功能补的是一个真窟窿：popup 一直有「备份 JSON」却没有导回去的地方，
   而采集数据只活在这台电脑的 chrome.storage 里。还不回去的备份不是备份。

   核心语义是**整条覆盖 + 不删本地多出来的**，两条都得钉住：
     · 不整条覆盖 → "导出→在外面改→导回来"这个用途就废了
       （比如修被伪造的状态轨迹，字段级合并会把删掉的又合回来）
     · 删本地多出来的 → 导出之后新采的岗位会被静默抹掉 */
{
  const local = [
    { key: "boss:1", title: "旧标题", status: "已投" },
    { key: "boss:2", title: "本地独有" },
  ];
  const file = [
    { key: "boss:1", title: "文件里的标题", status: "已挂" },
    { key: "boss:3", title: "文件里独有" },
  ];
  const r = mergeBackup(local, file);
  check("覆盖计数", r.replaced === 1, "replaced=" + r.replaced);
  check("新增计数", r.added === 1, "added=" + r.added);
  const m = Object.fromEntries(r.next.map((x) => [x.key, x]));
  check("同 key 是**整条**覆盖，不是字段级合并", m["boss:1"].title === "文件里的标题" && m["boss:1"].status === "已挂");
  check("本地多出来的记录留着（不是恢复成快照）", !!m["boss:2"]);
  check("文件里多出来的加进来", !!m["boss:3"]);
  check("总数对", r.next.length === 3, String(r.next.length));
}
{
  const r = mergeBackup([{ key: "a" }], [{ nokey: 1 }, null, { key: "" }]);
  check("没有 key 的条目跳过并**报数**（不能静默吞掉）", r.skipped === 3, "skipped=" + r.skipped);
  check("跳过的不影响本地", r.next.length === 1);
}
check("传 null 不炸", mergeBackup(null, null).next.length === 0);
check("空文件不改动本地", mergeBackup([{ key: "a" }], []).next.length === 1);
