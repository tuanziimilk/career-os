// 手写 SVG 漏斗图。不引图表库——理由和 jd-insight 不用 LangChain 是同一个判断：
// 这里只需要一种图形（横向递减条），引入 ECharts/Recharts 要付构建体积和
// API 学习成本，换不到对应收益。六七十行手写 SVG 完全够用。
import type { FunnelRow } from "../lib/funnel";

export function FunnelChart({ rows }: { rows: FunnelRow[] }) {
  const W = 640;
  const rowH = 46;
  const gap = 10;
  const H = rows.length * (rowH + gap) - gap + 8;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const labelW = 96;
  const barMaxW = W - labelW - 90;

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={
            "投递漏斗：" +
            rows.map((r) => `${r.label} ${r.count} 条`).join("，")
          }
          style={{ display: "block", width: "100%", minWidth: 420, height: "auto" }}
        >
          {rows.map((r, i) => {
            const y = i * (rowH + gap);
            const w = maxCount ? (r.count / maxCount) * barMaxW : 0;
            const color =
              r.id === "已挂" || r.id === "已拒"
                ? "var(--stop)"
                : r.optional
                  ? "var(--muted)"
                  : "var(--acc)";
            return (
              <g key={r.id + i}>
                <text
                  x={0}
                  y={y + rowH / 2 + 4}
                  fontSize="12.5"
                  fill="currentColor"
                  fontFamily="var(--sans)"
                >
                  {r.label}
                </text>
                <rect
                  x={labelW}
                  y={y + 6}
                  width={barMaxW}
                  height={rowH - 12}
                  rx={4}
                  fill="var(--sunk)"
                />
                <rect
                  x={labelW}
                  y={y + 6}
                  width={Math.max(2, w)}
                  height={rowH - 12}
                  rx={4}
                  fill={color}
                  opacity={r.optional ? 0.55 : 0.9}
                />
                <text
                  x={labelW + barMaxW + 10}
                  y={y + rowH / 2 - 3}
                  fontSize="13"
                  fontWeight={700}
                  fill="currentColor"
                  fontFamily="var(--mono)"
                >
                  {r.count}
                </text>
                <text
                  x={labelW + barMaxW + 10}
                  y={y + rowH / 2 + 13}
                  fontSize="10.5"
                  fill="var(--muted)"
                  fontFamily="var(--mono)"
                >
                  {r.optional
                    ? "标记"
                    : r.rate == null
                      ? "—"
                      : `${Math.round(r.rate * 100)}%`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        每行左侧是阶段、条形长度代表到达该阶段的岗位数、右侧上方是数量、下方是相对上一必经阶段的转化率。
        「想投」是可跳过的标记阶段，不计入转化率（灰色条）。已挂/已拒用红色标出。
      </figcaption>
    </figure>
  );
}
