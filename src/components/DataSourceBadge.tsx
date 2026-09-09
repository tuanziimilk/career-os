// 数据源角标：右上角常驻，永远告诉你现在看的是哪种数据。
// 这不是装饰——之前的方案讨论里，"给面试官看真实数据"这条被否掉了，
// 就是因为没有这么一个明确的区分标记会让人看错。
import type { DataSource } from "../lib/types";

export function DataSourceBadge({ source }: { source: DataSource }) {
  const cls = source.kind === "supabase" ? "real" : source.kind === "local" ? "local" : "demo";
  // 标签文字用英文短码：中文"演示数据"在 10px 全大写 mono 里挤不开，
  // 而这个位置的功能是"一眼分辨"，不是"读懂说明"。完整说明在 title 里。
  const code =
    source.kind === "supabase" ? "Live" : source.kind === "local" ? "File" : "Demo";
  return (
    <span className={`badge ${cls}`} title={`当前数据源：${source.label}`}>
      {code}
    </span>
  );
}
