# Career OS · 求职工作台

> 工程决策与取舍（含工作台与扩展**为什么分开**、共享物如何防分叉）写在扩展仓库的
> [ARCHITECTURE.md](../ARCHITECTURE.md) —— 那份文档同时覆盖两边。

一个人的求职数据中枢：投递漏斗、学习进度、面试题刷题。

跟同仓库的 [`extension/`](../extension)（浏览器扩展，负责采集 JD 和聊天式分析）是同一套体系的两个界面，各自做自己适合的事——**该统一的是数据契约，不是界面**。

> 2026-09-15 起两者在同一个 git 仓库。运行时仍然分开：扩展零构建，工作台在 `web/` 下独立 `vite build`。

## 三种数据源，同一套渲染层

| 数据源 | 何时用 | 谁能看到 |
|---|---|---|
| 🔵 演示数据 | 部署到公网的默认状态，面试官打开看到的就是它 | 任何人 |
| 🟠 本地文件 | 读 jd-insight 导出的 `jd_backup.json`，不接后端也能看真实数据 | 只有你（数据不出这台电脑） |
| 🟢 云端真实数据 | 登录后从 Supabase 读，跨设备同步 | 只有登录的你（RLS 强制） |

**真实数据永远不会出现在公开部署的产物里**——不是"用密码挡住"，是从一开始就没有引用路径。demo 数据是精心设计的虚构数据（虚构公司名、覆盖沉默/挂科/多种归因），不是空壳。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填你的 Supabase URL 和 anon key（可选，不填就只有演示+本地两种源）
npm run dev
```

## 建表（只需做一次）

去 Supabase Dashboard → SQL Editor，粘贴 `supabase/schema.sql` 整段执行。

五张表：`career_jds` `career_status_history` `career_profile` `career_learning_progress` `career_question_practice`，全部 `career_` 前缀（避免和同项目里的其他表冲突），全部默认 RLS 开启、只放行 `auth.uid()` 等于自己。

## 部署

```bash
GITHUB_PAGES=true npm run build
```

产物在 `dist/`，可以直接推到 GitHub Pages。`.env.local` 不会被打进构建产物之外的任何地方，但**别把它提交进仓库**（已在 `.gitignore` 里）。

## 目录

```
web/
├── src/
│   ├── lib/
│   │   ├── types.ts          数据契约：DataSource 接口，三种数据源都实现它
│   │   ├── funnel.ts         漏斗指标计算（含"想投是可跳过标记阶段"这个真实踩过的坑）
│   │   ├── demoData.ts       演示数据
│   │   ├── localSource.ts    本地文件数据源（File System Access API）
│   │   ├── supabaseClient.ts / supabaseSource.ts   云端数据源
│   │   └── useDataSource.ts  三选一路由：supabase(已登录) > local(已连) > demo
│   ├── components/            FunnelChart（手写 SVG）、CapabilityBars、数据源角标与切换器
│   └── pages/                 总览 / 投递 / 学习 / 刷题
└── supabase/schema.sql        建表脚本
```

## 设计决策摘要

- **手写 SVG 图表，不引图表库** —— 只需要一种图形（横向条形），几十行搞定，不用为此引入构建体积
- **HashRouter** —— 静态托管没有服务端路由改写，history 模式的深链接刷新会 404
- **anon key 可以公开** —— 权限完全由数据库 RLS 决定，不是"泄露了就完了"
- **本地文件与云端数据源目前只覆盖"投递"页需要的数据**（jobs），学习/刷题的数据落地等后续需要时再补
