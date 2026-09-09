/* 学习页 = Expedition Map / 探险路线图。
 *
 * 为什么不是九个平行的折叠条：M1~M9 本来就是一条**有顺序的路线**
 * （SEO → Technical SEO → GEO → AI Search → Agent → AI Product）。
 * 平行列表把顺序这个信息丢掉了；连着的里程碑把它画出来。
 *
 * 内容来自 src/data/modules.json（Obsidian 单向导入），
 * 状态来自数据源——"内容与状态分离"决策的落地，这里只负责按 id 拼起来。
 */
import { useEffect, useMemo, useState } from "react";
import type { DataSource, LearningModule, ModuleStatus } from "../lib/types";
import modulesContent from "../data/modules.json";
import { RevealCard } from "../components/RevealCard";
import { Stamp, type StampTone } from "../components/Stamp";

interface ModuleCard {
  id: string;
  title: string;
  excerpt: string;
}
interface ModuleContent {
  id: string;
  title: string;
  cards: ModuleCard[];
}

const CONTENT = modulesContent as ModuleContent[];

const STATUS_CYCLE: ModuleStatus[] = ["未读", "在读", "已懂", "能空手讲"];

/* 四档状态 → 印章。文字用英文短码：印章是 mono 全大写小字号，
   中文"能空手讲"在这个尺寸里挤不开，而完整中文就在旁边的按钮上。 */
const STATUS_STAMP: Record<ModuleStatus, { text: string; tone: StampTone }> = {
  未读: { text: "UNREAD", tone: "grey" },
  在读: { text: "READING", tone: "blue" },
  已懂: { text: "UNDERSTOOD", tone: "blue" },
  能空手讲: { text: "LEARNED", tone: "ok" },
};

export function Learning({ source }: { source: DataSource }) {
  const [statusByModule, setStatusByModule] = useState<Record<string, ModuleStatus>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openModule, setOpenModule] = useState<string | null>(null);
  const writable = source.kind === "supabase";

  async function load() {
    const rows: LearningModule[] = await source.getLearning();
    const m: Record<string, ModuleStatus> = {};
    rows.forEach((r) => (m[r.id] = r.status));
    setStatusByModule(m);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const doneCount = useMemo(
    () => CONTENT.filter((m) => statusByModule[m.id] === "能空手讲").length,
    [statusByModule]
  );
  const totalCards = useMemo(
    () => CONTENT.reduce((n, m) => n + m.cards.length, 0),
    []
  );

  async function cycleStatus(moduleId: string) {
    if (!writable) {
      setError("当前数据源不支持写入——切换到云端数据源后再标记进度。");
      return;
    }
    const cur = statusByModule[moduleId] || "未读";
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length];
    setSaving(moduleId);
    setError("");
    const res = await source.setLearningStatus?.(moduleId, next);
    setSaving(null);
    if (!res?.ok) {
      setError(res?.reason || "保存失败。");
      return;
    }
    setStatusByModule((s) => ({ ...s, [moduleId]: next }));
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section>
        <div className="section-head">
          Expedition Log
          <span className="n">
            {CONTENT.length} 个模块 · {totalCards} 张卡片
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontFamily: "var(--serif)", fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
              {doneCount}
            </span>
            <span className="meta" style={{ fontSize: 13 }}>
              {" "}
              / {CONTENT.length}
            </span>
            <div className="label" style={{ marginTop: 3 }}>
              Modules learned · 能空手讲
            </div>
          </div>
          {/* 进度用刻度尺而不是圆角进度条：尺子是研究工具，进度条是 SaaS 语言 */}
          <div style={{ flex: "1 1 180px", minWidth: 140, paddingBottom: 4 }}>
            <div
              style={{
                position: "relative",
                height: 12,
                borderBottom: "1.5px solid var(--ink)",
                background: `repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px ${
                  100 / CONTENT.length
                }%)`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  height: 5,
                  width: `${(doneCount / (CONTENT.length || 1)) * 100}%`,
                  background: "var(--ok)",
                }}
              />
            </div>
          </div>
        </div>
        {!writable && (
          <p className="meta" style={{ marginTop: 10 }}>
            当前数据源「{source.label}」只读，点状态不会保存。
          </p>
        )}
        {error && (
          <p className="annot" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
      </section>

      {/* ── 路线 ─────────────────────────────────────── */}
      <section>
        <div className="section-head">
          Learning Map
          <span className="n">点模块名展开卡片 · 点印章切换状态</span>
        </div>

        <div style={{ display: "grid", gap: 0 }}>
          {CONTENT.map((mod, i) => {
            const status = statusByModule[mod.id] || "未读";
            const st = STATUS_STAMP[status];
            const isOpen = openModule === mod.id;
            const isLast = i === CONTENT.length - 1;
            return (
              <div
                key={mod.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "26px minmax(0, 1fr)",
                  columnGap: 12,
                }}
              >
                {/* 路线的一节：节点 + 往下的连线。这是"有顺序"的可视化载体 */}
                <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      marginTop: 13,
                      borderRadius: "50%",
                      border: "1.5px solid var(--ink)",
                      background: status === "能空手讲" ? "var(--ok)" : "var(--paper)",
                      zIndex: 1,
                    }}
                  />
                  {!isLast && (
                    <span
                      style={{
                        position: "absolute",
                        top: 22,
                        bottom: 0,
                        width: 1,
                        borderLeft:
                          status === "能空手讲" ? "1.5px solid var(--ok)" : "1.5px dashed var(--rule-strong)",
                      }}
                    />
                  )}
                </div>

                <div style={{ paddingBottom: isLast ? 0 : 4 }}>
                  <div
                    onClick={() => setOpenModule(isOpen ? null : mod.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "9px 0",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--rule)",
                    }}
                  >
                    <span className="refno" style={{ flex: "none", color: "var(--ink-3)" }}>
                      {mod.id}
                    </span>
                    <span
                      style={{ fontSize: 15, fontWeight: 600, minWidth: 0 }}
                    >
                      {mod.title}
                    </span>
                    <span className="meta" style={{ flex: "none" }}>
                      {mod.cards.length} 卡
                    </span>
                    <span
                      style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cycleStatus(mod.id);
                        }}
                        disabled={saving === mod.id}
                        title="点击切换：未读 → 在读 → 已懂 → 能空手讲"
                        style={{
                          background: "transparent",
                          border: 0,
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        {saving === mod.id ? (
                          <span className="meta">SAVING…</span>
                        ) : (
                          <Stamp tone={st.tone} title={status}>
                            {st.text}
                          </Stamp>
                        )}
                      </button>
                      <span className="meta" style={{ width: 10, textAlign: "center" }}>
                        {isOpen ? "−" : "+"}
                      </span>
                    </span>
                  </div>

                  {isOpen && (
                    <div style={{ display: "grid", gap: 9, padding: "12px 0 16px" }}>
                      {mod.cards.map((c) => (
                        <RevealCard key={c.id} prompt={c.title}>
                          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.excerpt}</p>
                        </RevealCard>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
