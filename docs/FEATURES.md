# 功能清册 · 现在到底有什么

> 2026-09-14 首次生成（机器扫描 + 人工校对未完成）。
>
> **这份文档和 ARCHITECTURE.md / PRD.md 的分工：**
> 那两份记的是**「为什么这么定」**，这份记的是**「现在有什么」**。
> 前者是决策档案，后者是资产清册。缺了后者的症状是：
> 已经做完的功能被当成待办重新规划（R2 引用校验）、
> 写完的函数没有任何界面调用（`funnel()` / `needsFollowUp()` / 能力自评写入）、
> 注释里承诺的界面并不存在（薪资批量补录）。
>
> ⚠️ **状态列是机器扫出来的骨架，「在用 / 有测试」两列需要你逐行确认。**
> 打 `?` 的是我没把握、需要你点一遍界面才能确认的。

**状态图例**

| 记号 | 含义 |
|---|---|
| ✅ | 有用户入口，走得通 |
| 🔧 | 内部能力，被别的模块调用（不直接面向用户） |
| 💤 | **实现完整但没有调用者** —— 这个项目反复出现的失败模式 |
| 📝 | **注释/文档承诺了，代码里不存在** |
| ❓ | 我没验证，需要你确认 |

---

## 一、Chrome 扩展 `extension/`（零构建，v2.2.0）

### 1.1 页面上的采集

| 能力 | 用户入口 | 实现 | 测试 | 状态 |
|---|---|---|---|---|
| 采集当前 JD | 页面右下角「+ 存 JD」/ `Alt+S` | `content.js` | 无端到端 | ✅ |
| 已知选择器抓字段 | 同上 | `content.js` `pick()` | 无 | ✅ |
| 启发式兜底扫正文 | 自动 | `content.js` | 无 | ✅ |
| 整页纯文本兜底 | 自动（截断 12000 字） | `content.js:824` | 无 | ✅ |
| jobId 去重键 | 自动 | `content.js` `getJobId()` | 无 | ✅ |
| 站点前缀 `boss:` | 自动 | `lib/jdMerge.js` | `eval-jd-merge.mjs` 46 条 | ✅ 2026-09-14 |
| 更新时字段合并（保投递历史） | 自动 | `lib/jdMerge.js` | 同上 | ✅ 2026-09-14 |
| 字体反爬还原薪资 | 自动 | `lib/glyphmap.js` | 无 | ✅ |
| 薪资解析 / 归一 | 自动 | `lib/salary.js` | `check-shared` 比对 web 端 | 🔧 |
| 薪资补录 | 弹窗列表里每条的「＋薪资」chip，点击原地变输入框 | `popup.js:250` `setSalary()` | 无 | ✅ **2026-09-15 更正** |

### 1.2 扩展弹窗（popup）

| 能力 | 入口 | 实现 | 状态 |
|---|---|---|---|
| 已存条数 / 列表 | 弹窗主体 | `popup.js` | ✅ |
| 打开情报台 | 「打开情报台（问它）」 | `popup.js` → sidepanel | ✅ |
| 手动同步云端 | 「同步到云端」 | `lib/syncSupabase.js` | ✅ |
| 导出 TXT / 复制 / 备份 JSON | 三个按钮 | `popup.js` | ✅ |
| 打标：意向 / 状态 / 挂掉原因 | 列表项内 | `popup.js` `setField()` | ✅ |
| 清空全部 | 「清空全部记录」 | `popup.js` + 墓碑 | ✅ |
| 手填薪资 | 列表项内 | `popup.js:63-70` | ✅ |

### 1.3 侧边栏情报台（对话）

| 能力 | 入口 | 实现 | 测试 | 状态 |
|---|---|---|---|---|
| 对话主链路 | 「对话」标签页 | **`sidepanel.js` 的 `ask()`** | 无（不可脚本调用） | ✅ |
| 意图识别（规则先行） | 自动 | `lib/intents.js` `ruleClassify()` | `eval-intents.mjs` | ✅ |
| 意图识别（模型兜底） | 自动 | `lib/intents.js` `classifyPrompt()` | 部分 | ✅ |
| 系统提示词拼装（按意图分块 + 前缀缓存序） | 自动 | `lib/intents.js` `systemPrompt()` | 无 | ✅ |
| 关键词检索 + 字段加权 | 自动 | `lib/retrieve.js` | `eval-retrieve.mjs` | ✅ |
| 确定性统计（STATS） | 提问触发 | `lib/retrieve.js` `stats()` | 部分 | ✅ |
| 能力缺口（GAP，不进模型） | 提问触发 | `lib/gap.js` | `eval-gap.mjs` | ✅ |
| 红线拒答（GUARD） | 提问触发 | `lib/intents.js` | `eval-intents.mjs` | ✅ |
| 槽位填充 / 跳过降级 | 自动弹卡片 | `sidepanel.js` `askSlot()` | 无 | ✅ |
| **引用校验** | 回答下方校验条 | `lib/cite.js` | `eval-cite.mjs` 31 条 | ✅ 2026-09-11 |
| 成本 / token 显示 | 页头胶囊 | `lib/llm.js` | `eval-pricing.mjs` | ✅ |
| 错误分类与文案 | 出错时 | `lib/llm.js` | `eval-errors.mjs` | ✅ |
| 漏斗标签页 | 「漏斗」标签页 | `lib/funnelUI.js` + `lib/pipeline.js` | 无 | ✅ 2026-09（v2.15 修的零调用） |
| 幻觉自检 | —— | 不存在 | —— | 📝 ROADMAP v2.1 第 3 项 |
| **`PIPELINE` 意图**（「哪些岗位该跟进」） | —— | `pipeline.js` 的 `needsFollowUp()` **已实现** | —— | 💤 标杆集 A12 挂着 |
| 薪资中位数 | —— | `stats()` 里无执行体 | —— | 📝 标杆集 A13 |
| 城市分布提问 | —— | `stats()` 算了 cities，没路由 | —— | 💤 标杆集 A8 |

### 1.4 设置页

| 能力 | 实现 | 状态 |
|---|---|---|
| 厂商 / 模型 / Key（按厂商分开存） | `options.js` + `lib/providers.js` | ✅ |
| 关闭思考模式 | `lib/providers.js` `thinkOffBody` | ✅ |
| Cloud Sync（URL / anon key / 邮箱密码登录） | `lib/syncSupabase.js` | ✅ |
| 本地数据与累计用量 | `options.js` | ✅ |
| 手填模型价格 | 字段还在，**界面已删** | 💤 兼容老用户，见 `llm.js` 注释 |

### 1.5 Python 分析侧

| 能力 | 入口 | 实现 | 状态 |
|---|---|---|---|
| JD 汇总报告 | `python analyzer/analyze_jd.py` | `analyze_jd.py` | ✅ |
| 能力组词典 | `analyzer/config.py` `GROUPS` | —— | ⚠️ **与 `web/src/data/skills.json` 分叉**，合并排在 P2.7 |
| 个人能力现状 | `analyzer/config.py` `MY_PROFILE` | —— | ⚠️ **仍是示例占位**，报告缺口章因此不输出 |
| 样本 < 10 条闸门 | 自动 | `analyze_jd.py` | ✅ |
| JobSpy 导入（LinkedIn 等） | —— | 不存在 | 📝 ROADMAP v2.2 L3 |

---

## 二、Career OS 工作台 `web/`（Vite + React + TS）

七个页面，都挂在 `web/src/App.tsx` 的路由上，每个页面一个文件、一个默认导出：

| 路由 | 页面 | 实现（均在 `web/` 下） | 行数 | 状态 |
|---|---|---|---|---|
| `/` | 总览 | `pages/Overview.tsx` | 268 | ✅ |
| `/pipeline` | 投递漏斗 | `pages/Pipeline.tsx` | 425 | ✅ |
| `/learning` | 学习进度 | `pages/Learning.tsx` | 320 | ✅ |
| `/match` | 匹配分析 | `pages/Match.tsx` | 474 | ✅ |
| `/practice` | 题库练习 | `pages/Practice.tsx` | 196 | ✅ |
| `/resume` | 简历管理 | `pages/Resume.tsx` | 279 | ✅ |
| `/calibration` | **07 校准台** | `pages/Calibration.tsx` | 533 | ✅ P0 新增 |

### 支撑库

| 模块 | 干什么 | 被几个文件用 | 状态 |
|---|---|---|---|
| `lib/types.ts` | 全局类型 | 20 | 🔧 |
| `lib/funnel.ts` | 漏斗计算（10 个导出） | 7 | 🔧 |
| `lib/match.ts` | 匹配打分（6 个导出） | 5 | 🔧 |
| `lib/salary.js` | 薪资解析 | 8 | 🔧 与扩展共享，`check-shared` 守着 |
| `lib/supabaseSource.ts` | 云端数据源 | 1 | 🔧 480 行 |
| `lib/localSource.ts` | 本地数据源 | 2 | 🔧 |
| `lib/rowVersion.ts` | 乐观并发（P1.7） | 2 | 🔧 `eval-row-version.mjs` |
| `lib/demoData.ts` | demo 数据 | 1 | 🔧 截图用 |
| `lib/resume.ts` | PDF / Word 解析 | 3 | 🔧 按需加载 |
| `lib/capabilityNote.ts` | 能力自评 | 2 | 🔧 `eval-capability-note.mjs` |
| `lib/activity.ts` / `learningProgress.ts` | 活动 / 学习进度 | 2 / 3 | 🔧 |

### 机器闸门（`npm run build` 前依次执行）

`check:shared` → `check:thresholds` → `check:eol` → `check:diagrams` → `check:content` → `eval` → `tsc -b` → `vite build`

| 闸门 | 守什么 |
|---|---|
| `check-shared.mjs` | 扩展与 web 的共享物不许分叉（薪资 / 技能 / 漏斗常量） |
| `check-thresholds.mjs` | 18 项阈值登记与代码必须同步改 |
| `check-line-endings.mjs` | 换行符 |
| `check-diagrams.mjs` | 图表 |
| `review-content.mjs` | 内容签章 |
| `eval-capability-note` / `eval-question-ids` / `eval-leaks` | 三套断言 |

扩展侧另有：`eval-all.mjs` 汇总 `eval-cite` / `eval-errors` / `eval-gap` / `eval-intents` / `eval-jd-merge` / `eval-pricing` / `eval-retrieve` + `check-syntax`。

---

## 三、机器扫出来的问题（需要你判断）

### 3.1 导出了但全项目找不到使用处的符号 —— **2026-09-16 已机器化，全部处理完**

> 这一节原来是一张 11 项**全打着 ❓** 的猜测表，是一次性人工 grep 的结果。
> 现在由 `scripts/check-orphans.mjs` 每次 `npm run verify` / CI 自动对账，
> 白名单在 `scripts/orphan-allowlist.json`。**这一节不再手工维护。**

处理结果（114 个具名导出，逐个查过）：

| 处置 | 数量 | 明细 |
|---|---|---|
| **取消 export** | 7 | `DOMAIN_LABEL` · `collectPua` · `SITE_PREFIX` · `splitUsage` · `bumpUsage` · `tokenize` · `ensureHostPermission` —— 它们**在自己文件里是有用的**，只是没必要导出 |
| **删掉** | 3 | `stageIndex`（`funnel()` 内部自己算索引）· `LEVEL_MARKS`（校准台有自己更完整的 `LEVELS`）· `quickCoverage`（Match 页直接调 `analyzeMatch`，拿到的信息比它多） |
| **白名单** | 0 | 目前一条都不需要 |

两处值得记下来的更正：

- **`ensureHostPermission` 不是问题。** 原表写着「权限相关的东西没被调用比较可疑」——
  它**是被调用的**，就在同文件的 `login()` 里。跨文件 grep 看不见同文件调用，
  于是把「只在内部用」误判成了「没人用」。
- **`quickCoverage` 删得有额外收益。** 它 `return r.ok ? r.coverage : null`，
  把「这条分析不了」和「算得出但覆盖率为空」压成同一个 `null`；
  而 Match 页的列表同时需要这两个信息，所以它本来就没法用这个函数。

> `.d.ts` 文件显示零引用是扫描器的假阳性，类型声明是隐式加载的 ——
> `check-orphans.mjs` 已经把 `.d.ts` 排除在外。

### 3.2 三个「实现完整、零调用者」（💤）

这是这个项目最该机器化防住的一类：

1. `pipeline.js` 的 `needsFollowUp()` —— **措辞要精确**：它不是零调用者
   （漏斗标签页和首页都在用，11 处引用）。缺的是**对话侧没有 `PIPELINE` 意图**，
   所以你没法问「我有哪些岗位该跟进了」（标杆集 A12）。
   ⚠️ 原文写成「零调用者」会让人以为整个函数没人用 —— 而那正是 FEATURES 自己
   警告过的第二个方向：**做了但清册还记着没做**
2. `stats()` 算出的 `cities` —— `answerStats` 没路由（标杆集 A8）
3. 设置页手填价格 —— 字段在、界面删了（这条是**故意的**，见 `llm.js` 注释）

> 这三条 `check-orphans.mjs` **抓不到**，因为它们的函数都有调用者 ——
> 缺的是「某条用户路径通不到它」。那是意图路由的问题，不是符号可达性的问题，
> 得靠 `eval-intents.mjs` 里那几条标着「已知洞」的用例看住。

### 3.3 一个「注释承诺了但不存在」（📝）

1. 幻觉自检 —— ROADMAP v2.1 第 3 项

> ~~2. 薪资批量补录界面~~ —— **2026-09-15 更正：它是存在的。**
> `popup.js:250` 每条记录都有「＋薪资」chip，点一下原地变输入框，
> 待补的那些还有 `.pend` 虚线边高亮。`content.js:137` 那句「回头在扩展弹窗里
> 内联批量补」**已经兑现**。
>
> 我判断错的原因值得记下来：我 grep 的是 `salaryPending` 这个**标志位**，
> 而 UI 是按 `r.salary` 空不空来决定显示的，压根没用那个标志。
> **搜标志不等于搜能力** —— 这正是为什么清册要按「用户从哪进」组织，
> 而不是按「哪个变量被用到」。

---

## 四、建议加的两个闸门

都是十几行的脚本，接在现有 gate 后面：

**`check:orphans.mjs`** —— 扫 `lib/` 的 export，全项目无使用处就报。
白名单写在这份文档 §3.1，改代码不改白名单就 build 失败。
**它直接杀掉 💤 这一类的复发。**

**`check:promises.mjs`** —— grep 注释里的「回头」「之后」「待补」「TODO」，
要求每条在本文档里有对应的 📝 行。`content.js:137` 那种承诺就跑不掉了。

---

## 五、这份文档怎么维护

**不要手写维护。** 每次做完一轮改动，跑一次扫描重新生成骨架，人工只改状态列。
扫描脚本建议落到 `scripts/scan-features.mjs`（现在还在临时目录）。

> **2026-09-15 更新**：两个仓库已合并（`git subtree`，career-web → `web/`），
> 这份清册终于和它描述的代码在同一个版本历史里了。
> 原来这里写着「它描述两个仓库却只能放在其中一个下面」——那句话本身就是合并的理由之一。
