import type { CapabilityRow } from "../lib/types";

const LEVEL_COLOR: Record<string, string> = {
  "🟢": "var(--ok)",
  "🟡": "var(--warn)",
  "🔴": "var(--stop)",
  "": "var(--muted)",
};

const LEVEL_WIDTH: Record<string, number> = {
  "🟢": 0.9,
  "🟡": 0.55,
  "🔴": 0.15,
  "": 0.3,
};

export function CapabilityBars({ rows }: { rows: CapabilityRow[] }) {
  // 缺口排行：🔴 优先，其次 🟡，🟢 排最后——和 jd-insight 报告的排序逻辑一致
  const order: Record<string, number> = { "🔴": 0, "🟡": 1, "": 2, "🟢": 3 };
  const sorted = [...rows].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sorted.map((r) => (
        <div key={r.group} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>{r.group}</span>
          <div>
            <div style={{ background: "var(--sunk)", borderRadius: 4, height: 20, overflow: "hidden" }}>
              <div
                style={{
                  width: `${(LEVEL_WIDTH[r.level] ?? 0.3) * 100}%`,
                  height: "100%",
                  background: LEVEL_COLOR[r.level] ?? "var(--muted)",
                  opacity: 0.85,
                  transition: "width .2s",
                }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{r.note}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
