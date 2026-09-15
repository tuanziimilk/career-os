// 内容（题干/答案/模块）来自 src/data/questions.json（导入脚本产出）；
// 作答结果（会/不会/模糊 + 错题次数）来自数据源（Supabase）——
// 之前版本这里完全没有反馈记录，只是静态"点开答案"的折叠。
import { useEffect, useMemo, useState } from "react";
import type { DataSource, QuestionResult } from "../lib/types";
import questionsContent from "../data/questions.json";
import { RevealCard } from "../components/RevealCard";
import { Stamp, type StampTone } from "../components/Stamp";

interface QuestionContent {
  id: string;
  module: string;
  question: string;
  answer: string;
}
const CONTENT = questionsContent as QuestionContent[];

/* 作答结果 → 印章。红笔批改的语言：会=✓、模糊=△、不会=!
   这三个符号来自真实批改习惯，比"会/模糊/不会"三个色块更快读。 */
const RESULT_MARK: Record<QuestionResult, { sign: string; text: string; tone: StampTone }> = {
  未测: { sign: "", text: "UNTESTED", tone: "grey" },
  会: { sign: "✓", text: "SOLID", tone: "ok" },
  模糊: { sign: "△", text: "SHAKY", tone: "blue" },
  不会: { sign: "!", text: "GAP", tone: "red" },
};
const RESULT_COLOR: Record<QuestionResult, string> = {
  未测: "var(--ink-3)",
  会: "var(--ok)",
  模糊: "var(--warn)",
  不会: "var(--red)",
};

interface Progress {
  result: QuestionResult;
  wrongCount: number;
}

export function Practice({ source }: { source: DataSource }) {
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [error, setError] = useState("");
  const writable = source.kind === "supabase";

  async function load() {
    const rows = await source.getQuestions();
    const m: Record<string, Progress> = {};
    rows.forEach((r) => {
      if (r.result && r.result !== "未测") m[r.id] = { result: r.result, wrongCount: r.wrongCount };
    });
    setProgress(m);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  async function mark(id: string, result: QuestionResult) {
    if (!writable) {
      setError("当前数据源不支持写入——切换到云端数据源后再记录结果。");
      return;
    }
    const prevWrong = progress[id]?.wrongCount || 0;
    const nextWrong = result === "会" ? prevWrong : prevWrong + 1;
    const res = await source.setQuestionResult?.(id, result, nextWrong);
    if (!res?.ok) {
      setError(res?.reason || "保存失败。");
      /* 这里比学习页更要紧：nextWrong 是"我读到的错题数 + 1"。
         不重新读的话，下一次点击又会从同一个旧基数 +1，错题数永远差一截。 */
      if (res?.conflict) await load();
      return;
    }
    setProgress((p) => ({ ...p, [id]: { result, wrongCount: nextWrong } }));
    setError("");
  }

  const modules = useMemo(() => Array.from(new Set(CONTENT.map((q) => q.module))), []);

  const filtered = useMemo(() => {
    return CONTENT.filter((q) => {
      if (moduleFilter !== "all" && q.module !== moduleFilter) return false;
      if (onlyWrong) {
        const r = progress[q.id]?.result;
        if (r === "会" || r == null) return false; // 错题重做：只留"不会/模糊"过的
      }
      return true;
    });
  }, [moduleFilter, onlyWrong, progress]);

  const doneCount = Object.values(progress).filter((p) => p.result === "会").length;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section>
        <div className="section-head">
          Interview Field Notes
          <span className="n">
            {filtered.length} / {CONTENT.length} 题
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 5, marginRight: 4 }}>
            <span style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 700, lineHeight: 1, color: "var(--ok)" }}>
              {doneCount}
            </span>
            <span className="meta">/ {CONTENT.length} 答得利索</span>
          </span>
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="all">全部模块</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} style={{ width: "auto" }} />
            只看错题/模糊
          </label>
        </div>
        {!writable && (
          <p className="meta" style={{ marginTop: 10 }}>
            当前数据源「{source.label}」只读，标记结果不会保存。
          </p>
        )}
        {error && (
          <p className="annot" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
      </section>

      {filtered.length === 0 ? (
        <p className="meta" style={{ padding: "18px 0", textAlign: "center" }}>
          {onlyWrong ? "没有错题——都标了「会」，可以取消筛选看全部。" : "没有匹配的题目。"}
        </p>
      ) : (
        filtered.map((q) => {
          const p = progress[q.id];
          return (
            <RevealCard
              key={q.id}
              prompt={
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ minWidth: 0 }}>
                    <span className="refno" style={{ marginRight: 6 }}>
                      {q.module}
                    </span>
                    {q.question}
                  </span>
                  {p && (
                    <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 6 }}>
                      {p.wrongCount > 0 && (
                        <span className="annot" style={{ fontSize: 11.5 }}>
                          错过 {p.wrongCount} 次
                        </span>
                      )}
                      <Stamp tone={RESULT_MARK[p.result].tone} title={p.result}>
                        {RESULT_MARK[p.result].sign} {RESULT_MARK[p.result].text}
                      </Stamp>
                    </span>
                  )}
                </div>
              }
            >
              <p style={{ margin: "0 0 12px" }}>{q.answer}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                {(["会", "模糊", "不会"] as QuestionResult[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => mark(q.id, r)}
                    disabled={!writable}
                    title={"标记为" + r}
                    style={{
                      flex: 1,
                      background: p?.result === r ? RESULT_COLOR[r] : "transparent",
                      borderColor: RESULT_COLOR[r],
                      borderWidth: 1,
                      color: p?.result === r ? "var(--paper)" : RESULT_COLOR[r],
                      fontSize: 10,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {RESULT_MARK[r].sign} {r}
                  </button>
                ))}
              </div>
            </RevealCard>
          );
        })
      )}
    </div>
  );
}
