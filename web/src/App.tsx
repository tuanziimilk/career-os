/* 桌面工作台。
 *
 * 不用传统 Sidebar + Dashboard：左侧是一条窄"档案目录"，当前项做成
 * 纸张侧面伸出来的文件夹 Tab（向右咬进内容区），而不是蓝色高亮块。
 * 顶部是报头，带期号——期号用真实数据（采集条数）算，不是装饰性假数字。
 */
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useDataSource } from "./lib/useDataSource";
import { DataSourceBadge } from "./components/DataSourceBadge";
import { SourceSwitcher } from "./components/SourceSwitcher";
import { Masthead } from "./components/Masthead";
import { Overview } from "./pages/Overview";
import { Pipeline } from "./pages/Pipeline";
import { Learning } from "./pages/Learning";
import { Practice } from "./pages/Practice";
import { Resume } from "./pages/Resume";
import { Match } from "./pages/Match";
import { Calibration } from "./pages/Calibration";

/* 编号是信息，不是装饰：它固定了模块顺序，也让"03 JD LAB"这种
   说法在你和我之间成为稳定的指代。所以编号跟着模块走，不跟着排序走。 */
const NAV = [
  { to: "/", no: "01", en: "TODAY", cn: "今日", end: true },
  { to: "/pipeline", no: "02", en: "APPLICATIONS", cn: "投递", end: false },
  { to: "/learning", no: "03", en: "LEARNING MAP", cn: "学习路线", end: false },
  { to: "/match", no: "04", en: "JD LAB", cn: "匹配分析", end: false },
  { to: "/practice", no: "05", en: "FIELD NOTES", cn: "面试题库", end: false },
  // 06 排在最后不是因为最不重要，而是因为它是**一次性**的：
  // 简历存好一次就不用天天来。日常高频的 01-05 排在前面。
  { to: "/resume", no: "06", en: "RESUME", cn: "简历正文", end: false },
  /* 07 校准台：能力自评编辑 + 词典体检。
     排最后是因为它是**维护入口**而不是日常动作 —— 但它不是可选的：
     04 匹配分析的唯一输入就是这里填的自评，在此之前那份自评
     没有任何编辑界面（updateCapabilities 实现完整却零调用者）。 */
  { to: "/calibration", no: "07", en: "CALIBRATION", cn: "校准台", end: false },
];

export default function App() {
  const { source, loading, refresh } = useDataSource();
  const loc = useLocation();
  const current = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));

  return (
    <div
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "26px 20px 70px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 168px) minmax(0, 1fr)",
        gap: 0,
        alignItems: "start",
      }}
    >
      {/* ── 档案目录 ─────────────────────────────────── */}
      {/* ⚠️ zIndex 不能省。position:sticky 会**自成层叠上下文**，于是
          「切换数据源」那个浮层里写的 z-index:10 出不了这个 aside——
          而 main 是 position:relative 且在 DOM 里排在 aside 之后，
          两者 z-index 都是 auto 时按文档顺序绘制，main 就盖在浮层上。
          实际跑起来才看到：浮层上半截被主内容区吃掉了。
          给 aside 一个 z-index，整棵子树才在 main 之上。 */}
      <aside style={{ paddingTop: 8, position: "sticky", top: 26, zIndex: 20 }}>
        <div
          className="refno"
          style={{ padding: "0 0 8px 2px", color: "var(--desk-ink-2)", borderBottom: "2px solid var(--desk-rule)", marginBottom: 2 }}
        >
          My Desk
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              style={({ isActive }) => ({
                display: "block",
                position: "relative",
                textDecoration: "none",
                padding: "9px 10px 9px 2px",
                borderBottom: "1px solid var(--desk-rule)",
                /* 选中项：纸从右侧探出来，和内容区连成一张纸 */
                background: isActive ? "var(--paper)" : "transparent",
                borderTop: isActive ? "1px solid var(--paper-edge)" : "1px solid transparent",
                borderLeft: isActive ? "3px solid var(--red)" : "3px solid transparent",
                paddingLeft: isActive ? 9 : 2,
                marginRight: isActive ? -1 : 0,
                zIndex: isActive ? 1 : 0,
                color: isActive ? "var(--ink)" : "var(--desk-ink)",
              })}
            >
              {({ isActive }) => (
                <>
                  <span
                    className="meta"
                    style={{ display: "block", color: isActive ? "var(--red)" : "var(--desk-ink-3)" }}
                  >
                    {n.no} {n.en}
                  </span>
                  <span
                    style={{ fontSize: 14.5, fontWeight: isActive ? 700 : 500 }}
                  >
                    {n.cn}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 16, display: "grid", gap: 8, justifyItems: "start" }}>
          <DataSourceBadge source={source} />
          <SourceSwitcher onChange={refresh} />
        </div>

        <p className="refno" style={{ marginTop: 20, lineHeight: 1.7, color: "var(--desk-ink-3)" }}>
          Clipping tool:
          <br />
          <a
            href="https://github.com/tuanziimilk/career-os"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--desk-link)" }}
          >
            jd-insight
          </a>
        </p>
      </aside>

      {/* ── 内容纸张 ─────────────────────────────────── */}
      <main
        className="paper"
        style={{ padding: "22px 26px 30px", minHeight: 620, borderLeft: "1px solid var(--paper-edge)" }}
      >
        <Masthead section={current ? current.en : ""} source={source} />

        {loading ? (
          <p className="meta" style={{ padding: "40px 0" }}>
            LOADING…
          </p>
        ) : (
          <Routes>
            <Route path="/" element={<Overview source={source} />} />
            <Route path="/pipeline" element={<Pipeline source={source} />} />
            <Route path="/learning" element={<Learning source={source} />} />
            <Route path="/match" element={<Match source={source} />} />
            <Route path="/practice" element={<Practice source={source} />} />
            <Route path="/resume" element={<Resume source={source} />} />
            <Route path="/calibration" element={<Calibration source={source} />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
