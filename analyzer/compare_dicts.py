# -*- coding: utf-8 -*-
"""两套技能词典跑同一批 JD，比谁漏判。

    python analyzer/compare_dicts.py
    python analyzer/compare_dicts.py --max 8    # 每组最多列几条漏判证据

══════════ 为什么需要这个 ══════════

这个项目现在有**两套词典**，都是按同一份简历长出来的，已经在各飘各的：

  A  analyzer/config.py 的 GROUPS       16 组，几百个词，无权重、无校准记录
  B  web/src/data/skills.json 的 SKILLS 26 项 / 15 组，有权重、有校准记录

组名 10 个重合，6 个只在 A，5 个只在 B。
两套的合并方案不该由谁"觉得"哪套好来定 —— 那正是这个项目反复栽过的地方。
拿真实 JD 量一遍，漏判清单摆出来，看着证据决定。

══════════ ⚠️ 一个关键的实验设计 ══════════

**两套词典走的是同一套匹配逻辑**（大小写无关的子串匹配），不是各用各的。

因为 A 和 B 的匹配实现本来就不同：
  · A 在 analyze_jd.py 里是整段小写子串匹配
  · B 在 web/src/lib/match.ts 里是句子级 + 位置加权打分

如果各用各的，测出来的差异是「词表差异 + 匹配逻辑差异」混在一起的，
没法归因 —— 而这次要回答的问题只有一个：**词表本身谁覆盖得全**。

代价是：B 在真实工作台里的表现和这里不完全一样（它的打分会过滤掉
弱证据，实际命中数可能比这里少）。所以这份报告只用来比词表，
不能拿来预测工作台的数字。

══════════ 怎么读结果 ══════════

只看「差异」那几行。两套都命中或都不命中的，对合并方案没有信息量。
每条差异都给了**是哪条 JD、靠哪个词命中的** —— 判断标准是：

    这个词命中的那句话，真的在说这个能力吗？

是 → 对方漏了，把词补过去。
否 → 命中方误判了，那个词该删或该收紧。
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from analyze_jd import load_blocks, parse_meta  # noqa: E402
from config import GROUPS as A_GROUPS  # noqa: E402

NL = chr(10)
MAX_EVIDENCE = 6
for i, a in enumerate(sys.argv):
    if a == "--max" and i + 1 < len(sys.argv):
        MAX_EVIDENCE = int(sys.argv[i + 1])

# ---------------------------------------------------------------- 读 B
SKILLS_PATH = os.path.join(ROOT, "web", "src", "data", "skills.json")
with io.open(SKILLS_PATH, encoding="utf-8") as f:
    SKILLS_DOC = json.load(f)
SKILLS = SKILLS_DOC["skills"]

# B 的词按组合并：一个组命中 = 它下面任何一项技能命中
B_GROUPS = {}
for sk in SKILLS:
    B_GROUPS.setdefault(sk["group"], [])
    B_GROUPS[sk["group"]].extend(sk["patterns"])

# ⚠️ 自检。两个词表任何一个读空了，下面的对比会安静地输出"完全一致"，
# 而那是这个项目最忌讳的假绿。宁可在这里炸。
assert len(A_GROUPS) >= 10, "A 词表只读到 %d 组，config.py 的 GROUPS 是不是变了？" % len(A_GROUPS)
assert len(B_GROUPS) >= 10, "B 词表只读到 %d 组，skills.json 的结构是不是变了？" % len(B_GROUPS)
assert sum(len(v) for v in A_GROUPS.values()) >= 100, "A 的词太少，八成没读对"
assert sum(len(v) for v in B_GROUPS.values()) >= 100, "B 的词太少，八成没读对"


def hit(text_low, words):
    """返回命中的词（去重、保持词表顺序）。大小写无关的子串匹配。"""
    out = []
    for w in words:
        if w and w.lower() in text_low and w not in out:
            out.append(w)
    return out


def snippet(text, word, width=34):
    """命中处前后各截一点，用来看这个词是不是命中在了对的地方。"""
    i = text.lower().find(word.lower())
    if i < 0:
        return ""
    a = max(0, i - width)
    b = min(len(text), i + len(word) + width)
    s = text[a:b].replace(NL, " ")
    s = re.sub(r"\s+", " ", s).strip()
    return ("…" if a > 0 else "") + s + ("…" if b < len(text) else "")


def main():
    blocks, used = load_blocks()
    if not blocks:
        return 1
    n = len(blocks)
    print("语料：%d 条，来自 %s" % (n, "、".join("%s(%d)" % (f, c) for f, c in used if c)))
    print()

    shared = [g for g in A_GROUPS if g in B_GROUPS]
    only_a = [g for g in A_GROUPS if g not in B_GROUPS]
    only_b = [g for g in B_GROUPS if g not in A_GROUPS]

    print("═" * 64)
    print("一、两边都有的 %d 个组 —— 只有这些能直接比" % len(shared))
    print("═" * 64)
    print()
    print("  %-18s %6s %6s %8s" % ("能力组", "A命中", "B命中", "差异条数"))
    print("  " + "─" * 46)

    diffs = {}  # group -> list of (which_missed, meta, words_of_hitter)
    totals = {"A": 0, "B": 0, "both": 0, "diff": 0}

    for g in shared:
        a_n = b_n = d_n = 0
        rows = []
        for blk in blocks:
            low = blk.lower()
            ah = hit(low, A_GROUPS[g])
            bh = hit(low, B_GROUPS[g])
            if ah:
                a_n += 1
            if bh:
                b_n += 1
            if bool(ah) == bool(bh):
                if ah:
                    totals["both"] += 1
                continue
            d_n += 1
            meta = parse_meta(blk)
            label = "%s / %s" % (
                (meta.get("公司") or "?")[:12],
                (meta.get("岗位") or "?")[:20],
            )
            if ah:
                rows.append(("B 漏了", label, ah[:3], blk))
                totals["A"] += 1
            else:
                rows.append(("A 漏了", label, bh[:3], blk))
                totals["B"] += 1
        totals["diff"] += d_n
        if rows:
            diffs[g] = rows
        mark = "" if d_n == 0 else ("  ←" if d_n >= 3 else "")
        print("  %-18s %5d %6d %8d%s" % (g[:18], a_n, b_n, d_n, mark))

    print()
    print("  差异合计：A 独有命中 %d 次，B 独有命中 %d 次" % (totals["A"], totals["B"]))
    print()
    print("  ⚠️ **别把命中多当成覆盖得好。** 多出来的命中有两种可能：",)
    print("     真的漏了（对方词表缺词）／ 误判（词太宽，命中在不相干的句子上）。")
    print("     这两种的处理方向完全相反，只能一条条看证据。")
    if totals["A"] == totals["B"] == 0:
        print("  两套在共有的组上完全一致 —— 选哪套就只看别的维度（权重、校准、维护成本）。")

    # ---------------------------------------------------------------
    if diffs:
        print()
        print("═" * 64)
        print("二、逐条差异 —— 这部分才是要你看的")
        print("═" * 64)
        print()
        print("判断标准：**命中的那句话，真的在说这个能力吗？**")
        print("  是 → 对方漏了，把词补过去")
        print("  否 → 命中方误判，那个词该删或该收紧")
        print()
        for g, rows in diffs.items():
            print("── %s ──" % g)
            for which, label, words, blk in rows[:MAX_EVIDENCE]:
                print("  %s  %s" % (which, label))
                for w in words:
                    print("      「%s」 %s" % (w, snippet(blk, w)))
            if len(rows) > MAX_EVIDENCE:
                print("  （还有 %d 条，加 --max 看更多）" % (len(rows) - MAX_EVIDENCE))
            print()

    # ---------------------------------------------------------------
    print("═" * 64)
    print("三、只有一边有的组 —— 这部分没法比，只能看要不要")
    print("═" * 64)
    print()
    for tag, gs, words_of in (("只在 A（analyzer）", only_a, A_GROUPS), ("只在 B（skills.json）", only_b, B_GROUPS)):
        print("%s：%d 个" % (tag, len(gs)))
        other = B_GROUPS if words_of is A_GROUPS else A_GROUPS
        for g in gs:
            c = sum(1 for blk in blocks if hit(blk.lower(), words_of[g]))
            mine = set(w.lower() for w in words_of[g])
            best, best_n = None, 0
            for og, ow in other.items():
                k = len(mine & set(w.lower() for w in ow))
                if k > best_n:
                    best, best_n = og, k
            note = ""
            if best and best_n >= 2:
                note = "  ← 对方把这些词并进了「%s」（%d 个词重合）" % (best, best_n)
            print("  %-20s 命中 %2d/%d 条%s" % (g[:20], c, n, note))
        print()

    print("⚠️ 两套走的是同一套匹配逻辑（子串），只换词表 —— 所以上面的差异")
    print("   全部归因于**词表**。工作台实际用的是句子级打分，命中数会比这里少，")
    print("   这份报告不能拿来预测工作台的数字。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
