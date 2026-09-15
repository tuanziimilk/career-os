/* 印章。状态用盖章表达，不用彩色 pill。
 *
 * 颜色只有三档，对应三种语义，不是七种状态七种颜色：
 *   红 = 需要行动 / 终局坏结果（已挂、已拒、待跟进）
 *   蓝 = 进行中（已投、进面、复面）
 *   绿 = 好结果 / 已完成（offer、能空手讲、已懂）
 *   灰 = 未开始 / 无状态
 * 这样一眼扫过去看到的是"红的要管、绿的放心"，而不是一堆需要解码的颜色。
 */
import type { ReactNode } from "react";

export type StampTone = "red" | "blue" | "ok" | "grey";

export function Stamp({
  children,
  tone = "grey",
  title,
}: {
  children: ReactNode;
  tone?: StampTone;
  title?: string;
}) {
  return (
    <span className={"stamp stamp-" + tone} title={title}>
      {children}
    </span>
  );
}

/** 投递状态 → 印章文字和色调。集中在一处，免得各页面各写一套映射。 */
export function statusStamp(status: string): { text: string; tone: StampTone } {
  switch (status) {
    case "offer":
      return { text: "OFFER", tone: "ok" };
    case "复面":
      return { text: "FINAL ROUND", tone: "blue" };
    case "进面":
      return { text: "INTERVIEW", tone: "blue" };
    case "已投":
      return { text: "APPLIED", tone: "blue" };
    case "想投":
      return { text: "SHORTLIST", tone: "grey" };
    case "已挂":
      return { text: "REJECTED", tone: "red" };
    case "已拒":
      return { text: "DECLINED", tone: "red" };
    default:
      return { text: "CLIPPED", tone: "grey" };
  }
}
