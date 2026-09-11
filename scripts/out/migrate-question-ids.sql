-- 题目 id：位置型 → 内容型 的一次性迁移
--
-- 背景：旧 id 是 `m1-q7` 这种，语义由「这条问答在 面试题库.md 里的出现次序」
-- 决定。往中间插一条新题，其后所有 id 平移，作答记录会静默挂到另一道题上。
-- 新 id 从题干内容派生，插入/删除/重排都不影响。
--
-- 映射按**题干文本**配对，不是按位置——按位置配会把记录搬到别的题上。
--
-- 怎么用：在 Supabase SQL Editor 里整段执行。它只动你自己的行（RLS 生效）。
-- ⚠️ 执行前扫一眼下面的注释行，确认「旧 id → 题干」看着对得上。这是改数据，不可逆。
-- ⚠️ 只该执行一次。重复执行是安全的（第二次匹配不到旧 id，0 行受影响）。


-- ════════ 第 1 步：先单独跑这一句，看看到底有没有东西要迁 ════════
--
-- 如果返回 0 行，说明你还没在 03 题库页标记过任何题 —— 那就**不用跑下面的迁移**，
-- 直接关掉这个文件即可。新 id 已经在 questions.json 里了，从现在起标记的都是新 id。
--
select count(*) as 待迁移行数
from career_question_practice
where user_id = auth.uid() and question_id ~ '^m[0-9]+-q[0-9]+$';


-- ════════ 第 2 步：确认上面 > 0 之后，再整段跑下面的 ════════

begin;

-- m1-q1 → [M1] 什么是 RAG？
update career_question_practice set question_id = 'q-896a8cf8' where question_id = 'm1-q1' and user_id = auth.uid();
-- m1-q2 → [M1] 检索不准怎么办？
update career_question_practice set question_id = 'q-17315e50' where question_id = 'm1-q2' and user_id = auth.uid();
-- m1-q3 → [M1] 怎么防幻觉？
update career_question_practice set question_id = 'q-948f12db' where question_id = 'm1-q3' and user_id = auth.uid();
-- m1-q4 → [M1] RAG vs 微调怎么选？
update career_question_practice set question_id = 'q-c9d8bd06' where question_id = 'm1-q4' and user_id = auth.uid();
-- m2-q5 → [M2] 什么是 Agent？
update career_question_practice set question_id = 'q-cfb28c1b' where question_id = 'm2-q5' and user_id = auth.uid();
-- m2-q6 → [M2] Agent vs 工作流？
update career_question_practice set question_id = 'q-f0c387bb' where question_id = 'm2-q6' and user_id = auth.uid();
-- m2-q7 → [M2] MCP 是什么？
update career_question_practice set question_id = 'q-d1d8bd0c' where question_id = 'm2-q7' and user_id = auth.uid();
-- m2-q8 → [M2] Agent 跑偏怎么办？
update career_question_practice set question_id = 'q-fcaef232' where question_id = 'm2-q8' and user_id = auth.uid();
-- m3-q9 → [M3] 为什么 LLM 要专门评测？
update career_question_practice set question_id = 'q-7e02c6ad' where question_id = 'm3-q9' and user_id = auth.uid();
-- m3-q10 → [M3] 怎么评一个 AI 功能？
update career_question_practice set question_id = 'q-5b834245' where question_id = 'm3-q10' and user_id = auth.uid();
-- m3-q11 → [M3] LLM-as-judge 靠谱吗？
update career_question_practice set question_id = 'q-60889a6f' where question_id = 'm3-q11' and user_id = auth.uid();
-- m3-q12 → [M3] 怎么防放量翻车？
update career_question_practice set question_id = 'q-3a468aa5' where question_id = 'm3-q12' and user_id = auth.uid();
-- m3-q13 → [M3] 技术指标 vs 业务指标？
update career_question_practice set question_id = 'q-2c726f7e' where question_id = 'm3-q13' and user_id = auth.uid();
-- m4-q14 → [M4] 拿到需求怎么做？
update career_question_practice set question_id = 'q-34e93c48' where question_id = 'm4-q14' and user_id = auth.uid();
-- m4-q15 → [M4] 怎么定成功指标？
update career_question_practice set question_id = 'q-c2dab6d8' where question_id = 'm4-q15' and user_id = auth.uid();
-- m4-q16 → [M4] 优先级怎么排？
update career_question_practice set question_id = 'q-7094bbde' where question_id = 'm4-q16' and user_id = auth.uid();
-- m4-q17 → [M4] 好 PRD 有什么？
update career_question_practice set question_id = 'q-2c3c4605' where question_id = 'm4-q17' and user_id = auth.uid();
-- m5-q18 → [M5] 大模型怎么训练？
update career_question_practice set question_id = 'q-37154df0' where question_id = 'm5-q18' and user_id = auth.uid();
-- m5-q19 → [M5] token / 温度？
update career_question_practice set question_id = 'q-e4ae4544' where question_id = 'm5-q19' and user_id = auth.uid();
-- m5-q20 → [M5] 为什么幻觉？怎么缓解？
update career_question_practice set question_id = 'q-e2333a2a' where question_id = 'm5-q20' and user_id = auth.uid();
-- m5-q21 → [M5] RAG/微调/prompt 怎么选？
update career_question_practice set question_id = 'q-033f6f49' where question_id = 'm5-q21' and user_id = auth.uid();
-- m5-q22 → [M5] 开源 vs 闭源？
update career_question_practice set question_id = 'q-14d42793' where question_id = 'm5-q22' and user_id = auth.uid();
-- m6-q23 → [M6] AI 时代 SEO 怎么变？
update career_question_practice set question_id = 'q-fe86c75d' where question_id = 'm6-q23' and user_id = auth.uid();
-- m6-q24 → [M6] 什么是 GEO？
update career_question_practice set question_id = 'q-2d8d6adf' where question_id = 'm6-q24' and user_id = auth.uid();
-- m6-q25 → [M6] 怎么让内容被 AI 引用？
update career_question_practice set question_id = 'q-a788bc16' where question_id = 'm6-q25' and user_id = auth.uid();
-- m6-q26 → [M6] AI 搜索底层？
update career_question_practice set question_id = 'q-52a598da' where question_id = 'm6-q26' and user_id = auth.uid();
-- m6-q27 → [M6] AI 大量产内容的风险？
update career_question_practice set question_id = 'q-5acfd9fd' where question_id = 'm6-q27' and user_id = auth.uid();
-- m7-q28 → [M7] 核心指标突然下降怎么排查？
update career_question_practice set question_id = 'q-05e40fe2' where question_id = 'm7-q28' and user_id = auth.uid();
-- m7-q29 → [M7] A/B 测试注意什么？
update career_question_practice set question_id = 'q-3b4553f4' where question_id = 'm7-q29' and user_id = auth.uid();
-- m7-q30 → [M7] 什么是好指标？
update career_question_practice set question_id = 'q-d627dc57' where question_id = 'm7-q30' and user_id = auth.uid();
-- m8-q31 → [M8] Agent 怎么判断要不要调工具？
update career_question_practice set question_id = 'q-7c134969' where question_id = 'm8-q31' and user_id = auth.uid();
-- m8-q32 → [M8] 调用失败/参数缺失怎么办？
update career_question_practice set question_id = 'q-764ff336' where question_id = 'm8-q32' and user_id = auth.uid();
-- m8-q33 → [M8] 上下文丢失/执行中断？
update career_question_practice set question_id = 'q-042b5f82' where question_id = 'm8-q33' and user_id = auth.uid();
-- m8-q34 → [M8] RAG 答不准从哪查？
update career_question_practice set question_id = 'q-dc7036bf' where question_id = 'm8-q34' and user_id = auth.uid();
-- m8-q35 → [M8] 怎么管理模型不确定性？
update career_question_practice set question_id = 'q-69b5a04c' where question_id = 'm8-q35' and user_id = auth.uid();
-- m8-q36 → [M8] 效果/成本/延迟怎么取舍？
update career_question_practice set question_id = 'q-c23261cf' where question_id = 'm8-q36' and user_id = auth.uid();
-- m8-q37 → [M8] 智能客服上线怎么判断变好？只看准确率够吗？
update career_question_practice set question_id = 'q-238c5aa9' where question_id = 'm8-q37' and user_id = auth.uid();
-- m8-q38 → [M8] Monitoring 和 Eval 有什么区别？
update career_question_practice set question_id = 'q-27ef8b0d' where question_id = 'm8-q38' and user_id = auth.uid();
-- m8-q39 → [M8] 怎么做版本对比？
update career_question_practice set question_id = 'q-5ab2b41a' where question_id = 'm8-q39' and user_id = auth.uid();

-- 迁移后还剩哪些旧格式的行：
select question_id, result, wrong_count from career_question_practice where user_id = auth.uid() and question_id ~ '^m[0-9]+-q[0-9]+$';

commit;
