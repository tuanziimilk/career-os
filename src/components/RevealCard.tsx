/* 索引卡 Index Card。
 *
 * 交互移植自 90-产出物/Agent系统六张脑图.html 已验证的"先遮住、点击揭晓"：
 * 逼自己先回忆再看答案，而不是扫一眼就过。这条不能省——它是这个页面
 * 唯一的学习机制，其他都只是排版。
 *
 * 视觉是档案索引卡：顶部一条红色横线（像卡片的题头线），
 * 左侧一列打孔位，正文用衬线。展开的箭头不用 chevron，用 mono 的 +/−。
 */
import { useState, type ReactNode } from "react";

export function RevealCard({
  prompt,
  children,
  revealLabel = "回忆完了 · 看答案",
  hideLabel = "收起",
}: {
  prompt: ReactNode;
  children: ReactNode;
  revealLabel?: string;
  hideLabel?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div
      className="paper"
      style={{
        padding: "11px 14px 12px 16px",
        borderTop: "2px solid var(--red)",
        /* 左侧装订边用 border 而不是 background-image——
           内联的 backgroundImage 会整个覆盖掉 .paper 的纸纹，得不偿失。 */
        borderLeft: "3px solid var(--red-soft)",
      }}
    >
      <div
        style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, marginBottom: 9 }}
      >
        {prompt}
      </div>
      <button
        className="ghost"
        onClick={() => setShown((s) => !s)}
        style={{
          padding: "4px 9px",
          fontSize: 9.5,
          borderStyle: "dashed",
          borderWidth: 1,
          borderColor: shown ? "var(--rule-strong)" : "var(--blue)",
          color: shown ? "var(--ink-3)" : "var(--blue)",
        }}
      >
        {shown ? "− " + hideLabel : "+ " + revealLabel}
      </button>
      {shown && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px dotted var(--rule-strong)",
            fontSize: 13,
            lineHeight: 1.75,
            color: "var(--ink-2)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
