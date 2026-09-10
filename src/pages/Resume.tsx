// 06 简历 —— 上传、解析、编辑、存云端。
//
// 为什么单独一页：简历是 04 匹配分析和扩展「简历诊断」的**唯一输入**。
// 在它之前，简历只以两种方式存在：知识库里的 Markdown 文件（人读）、
// 扩展设置页里一个粘贴框（只存在那台电脑的 chrome.storage 里）。
// 于是换台电脑就没有简历，匹配分析直接失效，而且没有任何提示。
//
// 这一页把它收成一处：解析在浏览器里做完，只把**纯文本**存进 Supabase
// 的 career_profile.resume_text，扩展下次同步拉下来。
// 不存原始文件——见 types.ts 里 ResumeRecord 的注释。
import { useEffect, useRef, useState } from "react";
import type { DataSource, ResumeRecord } from "../lib/types";
import { parseResumeFile, inspectResume } from "../lib/resume";

interface Props {
  source: DataSource;
}

/** 「上次更新 3 分钟前」。不引日期库，只要这一种表达。 */
function ago(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < 60e3) return "刚刚";
  const m = Math.floor(ms / 60e3);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function Resume({ source }: Props) {
  const writable = source.kind === "supabase";
  const [cloud, setCloud] = useState<ResumeRecord | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [via, setVia] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const r = (await source.getResume?.()) ?? null;
      if (!alive) return;
      setCloud(r);
      setText(r?.text || "");
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [source]);

  // 编辑过但还没保存 —— 这个状态必须显示出来，否则人会以为已经存了
  const dirty = text !== (cloud?.text || "");
  const info = inspectResume(text);

  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setError("");
    setNotice("");
    setWarnings([]);
    setParsing(`正在解析 ${file.name}…`);
    try {
      const r = await parseResumeFile(file);
      setText(r.text);
      setVia(`${file.name} · ${r.via}`);
      setWarnings(r.warnings);
      setNotice("解析完成，检查一下再保存。解析结果没保存之前不会影响任何分析。");
    } catch (e) {
      // 解析失败不清空已有内容 —— 人可能已经手工改过一版
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing("");
    }
  }

  async function save() {
    if (!writable) {
      setError("当前数据源不支持写入——切换到云端数据源再试。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const res = await source.setResume?.(text);
    setSaving(false);
    if (!res?.ok) {
      setError(res?.reason || "保存失败。");
      return;
    }
    setCloud({ text, updatedAt: new Date().toISOString() });
    setNotice("已保存到云端。扩展下次同步会拉到这一份。");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="section-head">
        Resume
        <span className="n">简历正文</span>
      </div>

      <p className="meta" style={{ maxWidth: "62ch", lineHeight: 1.7 }}>
        这里存的是<b>纯文本</b>，不是原始文件。04 匹配分析和插件里的「简历诊断」
        读的都是它——换台电脑也在，因为它存在云端。
      </p>

      {!writable && (
        <div className="annot">
          当前数据源「{source.label}」是只读的。切到云端数据源（右上角）才能保存。
        </div>
      )}

      {/* ── 上传区 ────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        style={{
          border: `1px dashed ${dragging ? "var(--blue)" : "var(--rule-strong)"}`,
          background: dragging ? "var(--hl)" : "transparent",
          borderRadius: 6,
          padding: "18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "flex-start",
          transition: "background .12s, border-color .12s",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => fileRef.current?.click()} disabled={!!parsing}>
            选择文件
          </button>
          <span className="meta">或把文件拖到这块区域</span>
        </div>
        <span className="meta" style={{ fontSize: 12 }}>
          支持 PDF / Word(.docx) / Markdown / txt，上限 4MB。
          扫描版 PDF（整页是图片）抽不出文字，会明确报错而不是存个空的。
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt,.text"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            // 清掉 value，否则连续选同一个文件不会触发 change
            e.target.value = "";
          }}
        />
        {parsing && (
          <span className="meta" style={{ color: "var(--blue)" }}>
            {parsing}
          </span>
        )}
        {via && !parsing && <span className="meta">来源：{via}</span>}
      </div>

      {error && (
        <div className="annot" style={{ color: "var(--red)", borderColor: "var(--red)" }}>
          {error}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="annot">
          {w}
        </div>
      ))}
      {notice && !error && <div className="annot">{notice}</div>}

      {/* ── 正文 ──────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="label">正文（可直接编辑）</span>
          <span className="meta refno">
            {loading
              ? "读取中…"
              : cloud
              ? `云端版本：${ago(cloud.updatedAt)}`
              : "云端还没有简历"}
            {dirty && !loading && " · 有未保存的改动"}
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={loading}
          placeholder="把简历正文粘贴进来，或用上面的按钮选个文件。"
          spellCheck={false}
          style={{
            minHeight: 320,
            resize: "vertical",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        />

        <div className="meta" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>
            <span className="num">{info.chars}</span> 字
          </span>
          <span>
            <span className="num">{info.lines}</span> 行
          </span>
        </div>

        {/* 体检结论不阻断保存，但要说清"存了也未必好用" */}
        {info.notes.map((n) => (
          <div key={n} className="annot">
            {n}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={save} disabled={!writable || saving || loading || !dirty}>
          {saving ? "保存中…" : dirty ? "保存到云端" : "已是云端版本"}
        </button>
        {dirty && (
          <button
            onClick={() => {
              setText(cloud?.text || "");
              setVia("");
              setWarnings([]);
              setNotice("");
              setError("");
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              color: "var(--ink-2)",
            }}
          >
            放弃改动
          </button>
        )}
      </div>
    </div>
  );
}
