-- Career OS · 建表脚本
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴执行即可。
--
-- 设计原则：
--   1. 表名统一 career_ 前缀。这套表现在独占一个 Supabase 项目（不和其他应用
--      混住），前缀保留是为了以后同项目扩展别的模块时不撞名。
--   2. 每张表默认 RLS 开启、默认无策略 = 谁都读不到写不到，
--      再逐条加"只有本人"的策略——先锁死，再显式放行，不是反过来。
--   3. 用 auth.uid() 判断"本人"，不是自己维护一份 user_id 白名单，
--      这样以后哪怕多个人用同一个项目（不会，但万一），也天然隔离。
--
-- 整份文件可以反复整段重跑，不会丢数据：
--   - 建表用 if not exists，函数用 create or replace，触发器用 create or replace
--     （需要 PostgreSQL 14+，Supabase 默认满足）。
--   - 策略（policy）没有 create or replace 语法，所以每条前面加了 drop if exists
--     再原样重建。策略本身不存任何数据，而且 SQL Editor 整段执行是一个事务，
--     不存在"drop 掉了但没建回来"的中间状态。
--   - 全文没有任何 drop table / truncate / delete。

-- ============================================================
-- 1. JD 采集（对应扩展导出的 jds）
-- ============================================================
create table if not exists career_jds (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  job_key       text not null,          -- 对应扩展里的去重键 jobId
  title         text,
  company       text,
  salary        text,
  tagline       text,
  body          text,
  page_text     text,
  url           text,
  site          text,
  intent        text,                   -- 🔥想投 / 👀观察 / ❌不考虑
  status        text default '',        -- 见 career_status_history 的枚举
  fail_reason   text,
  collected_at  timestamptz,            -- 扩展里的 ts（采集时刻）
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, job_key)
);

alter table career_jds enable row level security;

drop policy if exists "own rows only" on career_jds;
create policy "own rows only" on career_jds
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 2. 状态变更历史（漏斗指标的数据来源，见 jd-insight 的 lib/pipeline.js）
-- ============================================================
create table if not exists career_status_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) default auth.uid(),
  job_key    text not null,             -- 对应 career_jds.job_key
  status     text not null,             -- '' | 想投 | 已投 | 进面 | 复面 | offer | 已挂 | 已拒
  at         timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table career_status_history enable row level security;

drop policy if exists "own rows only" on career_status_history;
create policy "own rows only" on career_status_history
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists idx_status_history_job
  on career_status_history (user_id, job_key, at);

-- ============================================================
-- 3. 能力画像（对应 config.py 的 MY_PROFILE，含你的自评）
-- ============================================================
create table if not exists career_profile (
  user_id     uuid primary key references auth.users(id) default auth.uid(),
  resume_text text,                     -- 简历正文，供诊断用
  capabilities jsonb not null default '{}'::jsonb,  -- { "对话式产品": "🔴 没做过", ... }
  updated_at  timestamptz not null default now()
);

alter table career_profile enable row level security;

drop policy if exists "own row only" on career_profile;
create policy "own row only" on career_profile
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 4. 学习进度（M1~M9，四档：未读/在读/已懂/能空手讲）
-- ============================================================
create table if not exists career_learning_progress (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) default auth.uid(),
  module_id   text not null,            -- 'M1' ... 'M9'
  status      text not null default '未读'
              check (status in ('未读', '在读', '已懂', '能空手讲')),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (user_id, module_id)
);

alter table career_learning_progress enable row level security;

drop policy if exists "own rows only" on career_learning_progress;
create policy "own rows only" on career_learning_progress
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 5. 面试题刷题记录
-- ============================================================
create table if not exists career_question_practice (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) default auth.uid(),
  question_id text not null,            -- 面试题库里的题目 slug/hash
  result      text not null default '未测'
              check (result in ('未测', '会', '不会', '模糊')),
  last_practiced_at timestamptz,
  wrong_count int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (user_id, question_id)
);

alter table career_question_practice enable row level security;

drop policy if exists "own rows only" on career_question_practice;
create policy "own rows only" on career_question_practice
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 触发器：updated_at 自动刷新（四张需要它的表）
-- ============================================================
create or replace function career_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_jds_touch before update on career_jds
  for each row execute function career_touch_updated_at();
create or replace trigger trg_profile_touch before update on career_profile
  for each row execute function career_touch_updated_at();
create or replace trigger trg_progress_touch before update on career_learning_progress
  for each row execute function career_touch_updated_at();
create or replace trigger trg_practice_touch before update on career_question_practice
  for each row execute function career_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 学习活动日志（P5 新增）
--
-- 为什么需要单独一张表：career_learning_progress / career_question_practice
-- 每行只有一个 updated_at，也就是"最后一次改动"。9 个模块在 9 个不同日期
-- 被改过，不等于连续学习 9 天；而且同一个模块今天改完明天再改，昨天那次
-- 就被覆盖掉了。从这种数据里算"连续天数"只能得到一个看起来精确但其实是
-- 错的数字——这比不显示更糟。所以按天单独记一行。
--
-- 只记"哪天有动作、有几次"，不记改了哪个模块——那个信息在进度表里已经有了，
-- 这张表存在的唯一目的是回答"这一天你动过没有"。
create table if not exists career_activity (
  user_id          uuid not null references auth.users(id) default auth.uid(),
  day              date not null default current_date,
  learning_touches int  not null default 0,
  question_touches int  not null default 0,
  primary key (user_id, day)
);
alter table career_activity enable row level security;

drop policy if exists "own rows only" on career_activity;
create policy "own rows only" on career_activity
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 用函数而不是让前端 upsert：计数需要 count = count + 1 这种读改写，
-- PostgREST 的 upsert 只能整列覆盖，两个并发请求会丢掉一次计数。
create or replace function career_log_activity(kind text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if kind not in ('learning', 'question') then
    raise exception 'unknown activity kind: %', kind;
  end if;
  insert into career_activity (user_id, day, learning_touches, question_touches)
  values (
    auth.uid(),
    current_date,
    case when kind = 'learning' then 1 else 0 end,
    case when kind = 'question' then 1 else 0 end
  )
  on conflict (user_id, day) do update set
    learning_touches = career_activity.learning_touches + excluded.learning_touches,
    question_touches = career_activity.question_touches + excluded.question_touches;
end
$$;

-- ============================================================
-- 表级权限（显式声明，不依赖云端默认）
-- ============================================================
-- RLS 管的是"这一行你能不能看"，表级 GRANT 管的是"这张表你能不能碰"。
-- 两者是串联的两道门，GRANT 在前、RLS 在后；少了 GRANT 时 PostgREST 返回
-- 42501 permission denied for table，而不是 RLS 那种"200 + 空数组"。
--
-- Supabase 云端默认会把 public schema 里新建的表自动暴露给 API 角色
-- （见 config.toml 的 auto_expose_new_tables 注释），所以这一段在当前配置下
-- 其实是冗余的。保留它是因为那个默认可以被关掉，而一旦关掉、又没有这段，
-- 症状会是"登录后工作台全空且不报错"——那种问题很难查。显式声明比依赖默认值可靠。
--
-- 只授给 authenticated，不授给 anon：
--   工作台的每个读写方法都先检查登录态，未登录直接短路返回空，
--   从来不发匿名请求。anon 拿不到任何权限，也就没有"忘了写策略导致
--   匿名可读"这类风险面。
--
-- 授了表权限也不等于能看别人的数据——行的可见性完全由上面那些
-- "own rows only" 策略用 auth.uid() 决定，GRANT 只是把门打开到 RLS 那一层。
grant select, insert, update, delete on
  career_jds,
  career_status_history,
  career_profile,
  career_learning_progress,
  career_question_practice,
  career_activity
to authenticated;

grant execute on function career_log_activity(text) to authenticated;

-- ============================================================
-- 结构化薪资（扩展 v1.2 起采集时解析，见 jd-insight/extension/lib/salary.js）
-- ============================================================
-- 为什么不用一个 jsonb 列：这些数字存在的唯一目的是排序、筛选、算分布。
-- (salary_parsed->>'min')::int 既难写也难加索引，而独立列可以直接
-- order by / where / 建索引，还能用 check 约束挡住脏数据。
--
-- 刻意不存年薪：annual = min * coalesce(months, 12)，是纯函数。
-- 存下来只会出现"月薪改了年薪没改"的不一致，需要时在查询里算。
--
-- salary 原文列继续保留：解析失败时它是唯一线索，而且人看得懂
-- "面议"这种解析不出来的东西。数字列为 null 就代表"没有可用的数字"。
alter table career_jds add column if not exists salary_min     int;
alter table career_jds add column if not exists salary_max     int;
alter table career_jds add column if not exists salary_months   int;
alter table career_jds add column if not exists salary_period   text;
alter table career_jds add column if not exists salary_source   text;

-- 约束：宁可写入失败，也不要让一个荒唐的数字进来污染看板。
-- （曾经的 bug 就是把 "-K·13薪" 里的 13 当成薪资，会算出 13 元/月。）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'career_jds_salary_sane') then
    alter table career_jds add constraint career_jds_salary_sane check (
      (salary_min is null or salary_min between 1000 and 2000000)
      and (salary_max is null or salary_max between 1000 and 2000000)
      and (salary_min is null or salary_max is null or salary_min <= salary_max)
      and (salary_months is null or salary_months between 12 and 24)
      and (salary_period is null or salary_period in ('month', 'day', 'year'))
    );
  end if;
end
$$;

-- 按薪资排序/筛选是看板的主要用法，建个索引
create index if not exists idx_career_jds_salary
  on career_jds (user_id, salary_min desc nulls last);

-- ============================================================
-- 删除墓碑（三端同步的关键）
-- ============================================================
-- 为什么删除需要一张表：三个地方都能删（插件 / 工作台 / 直接改库），
-- 而"云端没有这条了"和"这条从来没同步过"在数据上长得一模一样。
-- 如果靠差异推断，插件下次同步就会把工作台刚删掉的记录重新 upsert 回来——
-- 记录复活，而且你不会发现。
--
-- 所以删除必须被**正面记录**：谁删的不重要，重要的是"这个 job_key 在
-- deleted_at 这一刻被删了"。各端同步时读这张表，把本地对应记录清掉。
--
-- ⚠️ deleted_at 不只是审计信息，它是**判断"删完又重新采集"的唯一依据**：
--    本地记录的采集时间比墓碑晚 → 说明是重新采的，墓碑作废；
--    早于墓碑 → 说明是该被删掉的旧记录。
--    没有这个比较，你删掉一个岗位后再也无法重新采集它。
create table if not exists career_deleted_jds (
  user_id    uuid not null references auth.users(id) default auth.uid(),
  job_key    text not null,
  deleted_at timestamptz not null default now(),
  -- 删除来源，纯给人看：排查"这条怎么没了"时有用
  deleted_by text,
  primary key (user_id, job_key)
);
alter table career_deleted_jds enable row level security;

drop policy if exists "own rows only" on career_deleted_jds;
create policy "own rows only" on career_deleted_jds
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on career_deleted_jds to authenticated;
