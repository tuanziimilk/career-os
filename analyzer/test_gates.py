# -*- coding: utf-8 -*-
"""两道闸门的行为测试。

    python jd-insight/analyzer/test_gates.py

⚠️ 为什么需要它：这两道闸门的作用是**拒绝输出**，而"拒绝"这个行为最容易
出两种相反的错 ——
  · 漏拦：占位自评被当成事实印出去（这就是它要修的那个已发生的问题）
  · 误伤：真填了却被判成占位，表现是"明明填了却拒绝出报告"

误伤比漏拦更让人不想用这个工具，所以两个方向都要测。

不测报告全文（那要造一份 JD 语料），只测判定函数本身 —— 它是两道闸门
唯一的决策依据。
"""
import os
import sys

# Windows 控制台默认 GBK，print 到 emoji 直接 UnicodeEncodeError ——
# 而这个测试的用例里必须带 🟢🟡🔴（那是自评的真实格式）。
# 强制 stdout 走 utf-8，否则测试会因为"打印失败"而不是"断言失败"而挂掉，
# 那种失败最容易被误读成代码有 bug。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import importlib.util

spec = importlib.util.spec_from_file_location(
    "analyze_jd", os.path.join(HERE, "analyze_jd.py")
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

fail = 0


def check(name, cond, detail=""):
    global fail
    print(("  ok   " if cond else "  FAIL ") + name + ("  " + detail if detail else ""))
    if not cond:
        fail += 1


print("── 占位识别（漏拦方向）──")
example = {
    "产品基本功": "🟢 示例：主导过某后台重构，PRD + 高保真原型 + 字段级规格",
    "数据能力": "🟢 示例：SQL / 漏斗分析 / 指标定义",
    "RAG / 检索": "🟡 示例：做过 Embedding 检索，缺生成侧",
    "对话式产品": "🔴 示例：没做过多轮对话产品",
}
ph = mod.placeholder_groups(example)
check("config.example.py 的四条全部被识别为占位", len(ph) == 4, str(ph))

print("\n── 真自评不被误伤（误伤方向）──")
real = {
    "产品基本功": "🟢 主导过内部后台系统重构，PRD + 字段级规格 + 验收标准",
    "RAG / 检索": "🟡 搭过知识库检索链路，重排这块没深入",
    "对话式产品": "🔴 空白",
}
check("真自评一条都不被判成占位", mod.placeholder_groups(real) == [],
      str(mod.placeholder_groups(real)))
# ⚠️ 极短的真自评最容易被"聪明的启发式"误伤，所以专门钉一条
check("极短的真自评也不被误伤（🔴 空白 / 🟢 做过）",
      mod.placeholder_groups({"a": "🔴 空白", "b": "🟢 做过"}) == [])

print("\n── 部分填写：只标出没填的那几个，不整章拒绝 ──")
mixed = dict(real)
mixed["工程实现"] = "🟡 示例：会看代码"
ph2 = mod.placeholder_groups(mixed)
check("只识别出那一条占位", ph2 == ["工程实现"], str(ph2))
check("部分填写不算整体不可用",
      not (bool(mixed) and len(ph2) == len(mixed)))

print("\n── 空自评不算「占位」（那是另一种情况）──")
check("空 dict 的 placeholder_groups 为空", mod.placeholder_groups({}) == [])
check("None 不炸", mod.placeholder_groups(None) == [])

print("")
print("── 空槽和占位是同一件事：都表示「这一组我还没判断过」──")

# ⚠️ 这一组断言补的是一个我 2026-09-16 亲手打开的洞。
# 当时把 config.py 里 4 条模板示例清空、补齐成 16 个空槽，
# 而 PROFILE_UNUSABLE 原来的判据是「是不是全都带『示例』」——
# 清空之后一条「示例」都没有了，闸门就认为"能用"，
# 于是一条自评都没有的情况下，缺口排行会照常输出。
# **清理模板这个动作本身把闸门关掉了，而且不报错。**
check("全空 = 不可用（这就是那个回归）",
      mod.usable_groups({"a": "", "b": "   "}) == []
      and mod.usable_groups({}) == [])
check("全是占位 = 不可用", mod.usable_groups({"a": "🟢 示例：随便写的"}) == [])
check("空 + 占位混着 = 还是不可用",
      mod.usable_groups({"a": "", "b": "🟡 示例：xx"}) == [])
check("只要有一条真的填了，就算可用",
      mod.usable_groups({"a": "", "b": "🔴 没做过多轮对话"}) == ["b"])
check("None 不炸", mod.usable_groups(None) == [])

print("")
print("")
print("── 去重键归一化：迁移前后的同一条 JD 不能算成两条 ──")

# ⚠️ 这一组补的是一个分母 bug。2026-09-16 的真实情况：
# data/ 里同时躺着迁移前和迁移后的两份备份，同一个岗位的键分别是
# `12345678` 和 `boss:12345678`，去重按字面比，于是同一条 JD 算了两次。
# 外加仓库自带的 sample_jd.txt 也被算进分母。
# 结果：样本量 13 被报成 17，而「对话式产品」的覆盖率从 15% 虚高到 24%
# （那几条示例数据正好是客服岗）。全程不报错，报告里只有一个看着很正常的数字。
check("站点前缀被剥掉", mod.norm_key("boss:12345678") == "12345678")
check("迁移前后归一到同一个键",
      mod.norm_key("12345678") == mod.norm_key("boss:12345678"))
check("别的站点前缀一样处理", mod.norm_key("liepin:abc") == "abc")
check("URL 降级键不动（它本来就带 ://）",
      mod.norm_key("https://www.zhipin.com/job_detail/x.html")
      == "https://www.zhipin.com/job_detail/x.html")
check("query 串照旧剥掉", mod.norm_key("boss:123?from=search") == "123")
check("空值不炸", mod.norm_key("") == "" and mod.norm_key(None) == "")

print("── 当前仓库的真实状态 ──")
print("  config.py 的 MY_PROFILE 共 %d 组：占位 %d 组，真正可用 %d 组"
      % (len(mod.MY_PROFILE), len(mod.PLACEHOLDER_GROUPS), len(mod.USABLE_GROUPS)))
check("PROFILE_UNUSABLE = 有 MY_PROFILE 但一条可用的都没有",
      mod.PROFILE_UNUSABLE == (len(mod.MY_PROFILE) > 0 and not mod.USABLE_GROUPS),
      "PROFILE_UNUSABLE=%s" % mod.PROFILE_UNUSABLE)
check("样本量下限是 10（和报告头部那句提示一致）", mod.MIN_SAMPLE == 10,
      str(mod.MIN_SAMPLE))

print("")
if fail:
    print("!! %d 条断言不过" % fail)
    sys.exit(1)
print("全部断言通过")
