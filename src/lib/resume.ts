// 简历文件 → 纯文本。
//
// 为什么要有这个文件：简历是匹配分析（match.ts）和扩展里「简历诊断」的唯一
// 输入。解析错了不会报错，只会让后面所有结论都建立在错的文本上——所以这里
// 的重点不是"能解析多少格式"，而是**解析不可靠时必须说出来**。
//
// 依赖选择
//   pdf：用 pdfjs-dist。PDF 的文本抽取要处理字体编码表和压缩流，手写必然
//        在某些文件上静默产出乱码。这是"宁可加依赖也不要自己写"的典型。
//   docx：用 mammoth。docx 是个 zip，理论上浏览器用 DecompressionStream
//        也能拆，但样式/表格/编号列表的取文本规则很多，同理不自己写。
//   md/txt：直接 file.text()，不需要任何库。
//
// ⚠️ 扫描版 PDF（整页是图片）抽不出任何文字，pdfjs 不会报错，只会返回空串
// 或零星的页码。这种情况必须当成失败告诉用户，否则他会以为简历已经存好了。

// Vite 需要把 worker 当独立资源打进产物，所以用 ?url 拿到最终地址。
// 不设 workerSrc 的话 pdfjs 会去猜路径，打包后必然 404。
// 这一行只是个字符串，静态引入不会把 worker 拉进主包。
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** 按需加载 pdfjs。
 *
 * ⚠️ 必须是动态 import。第一版我在文件顶部 `import * as pdfjs`，
 * 结果 pdfjs 主库被打进主 chunk，index.js 从三百多 KB 涨到 996 KB——
 * 每个访客都要下载 1MB，而绝大多数人从头到尾不会传一次 PDF。
 * 简历页本身就是"一次性"的，它的依赖更没有理由进首屏。 */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs;
}

export interface ParsedResume {
  text: string;
  /** 解析用的路径，显示给用户看，便于判断结果可不可信 */
  via: string;
  /** 不阻断但需要人知道的问题 */
  warnings: string[];
}

/** 一份能用来做匹配分析的简历，正文至少要有这么多字。
 *  低于这个数基本只有两种情况：扫描版 PDF，或者选错了文件。 */
const MIN_USEFUL_CHARS = 200;

const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [, ""])[1];

/** PDF：逐页取文本。pdfjs 给的是一堆带坐标的文本片段，不是段落，
 *  所以要自己按 y 坐标合行——不然整页会变成一长串没有换行的字。 */
async function fromPdf(file: File): Promise<ParsedResume> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const warnings: string[] = [];
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // 按 y 分行：同一行的片段 transform[5]（y）几乎相同。
    // 阈值 2 是经验值——小于字高就够，太大会把相邻两行并成一行。
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: item.transform[4], s: item.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // y 从大到小 = 从上往下
      .map(([, frags]) =>
        frags
          .sort((a, b) => a.x - b.x)
          .map((f) => f.s)
          .join("")
          .trim()
      )
      .filter(Boolean);
    pages.push(lines.join("\n"));
  }

  const text = pages.join("\n\n").trim();
  if (doc.numPages > 0 && text.length < MIN_USEFUL_CHARS) {
    // 这不是"解析得不够好"，是"根本没有文字层"。必须当失败处理。
    throw new Error(
      `这份 PDF 里抽不出文字（${doc.numPages} 页只得到 ${text.length} 个字符）。` +
        "常见原因是它是扫描件或整页图片。请把简历正文复制粘贴到下面的框里，" +
        "或者导出一份带文字层的 PDF / Word / Markdown。"
    );
  }
  if (doc.numPages > 6) {
    warnings.push(`这份 PDF 有 ${doc.numPages} 页，确认没选错文件（简历一般 1–3 页）。`);
  }
  return { text, via: `PDF · ${doc.numPages} 页`, warnings };
}

/** docx：mammoth 的 extractRawText 直接给纯文本，不带样式。 */
async function fromDocx(file: File): Promise<ParsedResume> {
  // 动态 import：mammoth 只在真的传了 .docx 时才需要，
  // 静态引入会让它进主 chunk，而大多数人从头到尾不会上传 Word。
  const mammoth = await import("mammoth/mammoth.browser.min.js");
  const buf = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  const text = (res.value || "").trim();
  if (text.length < MIN_USEFUL_CHARS) {
    throw new Error(
      `这份 Word 里只抽出 ${text.length} 个字符，太少了。` +
        "如果正文是图片或文本框，请直接把内容粘贴到下面的框里。"
    );
  }
  // mammoth 的 messages 是"有些东西我没能转换"的提示，不是错误，
  // 但对简历来说值得说一声：丢掉的可能正好是表格里的经历。
  const warnings = (res.messages || [])
    .map((m) => m.message)
    .filter(Boolean)
    .slice(0, 3)
    .map((m) => "Word 转换提示：" + m);
  return { text, via: "Word (.docx)", warnings };
}

async function fromPlain(file: File, label: string): Promise<ParsedResume> {
  const text = (await file.text()).trim();
  if (!text) throw new Error("这个文件是空的。");
  return { text, via: label, warnings: [] };
}

/**
 * 解析一个简历文件。
 * 失败一律抛错，错误信息写成"下一步该干什么"，不是"parse failed"。
 */
export async function parseResumeFile(file: File): Promise<ParsedResume> {
  const ext = extOf(file.name);
  // 4MB 以上的简历基本是内嵌了大图，抽文字没意义还会卡住页面
  if (file.size > 4 * 1024 * 1024) {
    throw new Error(
      `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB，太大了（上限 4MB）。` +
        "简历一般不到 1MB，这么大通常是里面嵌了大图。"
    );
  }
  switch (ext) {
    case "pdf":
      return fromPdf(file);
    case "docx":
      return fromDocx(file);
    case "md":
    case "markdown":
      return fromPlain(file, "Markdown");
    case "txt":
    case "text":
      return fromPlain(file, "纯文本");
    case "doc":
      throw new Error(
        "老版 .doc 格式解析不了（它不是 zip 结构）。请在 Word 里另存为 .docx，或直接粘贴正文。"
      );
    default:
      throw new Error(
        `不认识 .${ext || "（无扩展名）"} 这种格式。支持 PDF / Word(.docx) / Markdown / txt，` +
          "或者直接把正文粘贴到下面的框里。"
      );
  }
}

/** 简历文本的粗略体检。不阻断保存，只是让人知道这份文本长什么样。 */
export function inspectResume(text: string): { chars: number; lines: number; notes: string[] } {
  const t = text || "";
  const lines = t.split("\n").filter((l) => l.trim()).length;
  const notes: string[] = [];
  if (t.length < MIN_USEFUL_CHARS) {
    notes.push(`只有 ${t.length} 个字，匹配分析大概率给不出有用结论。`);
  }
  // 解析出来的文本常见毛病：整篇没有换行（PDF 合行失败）
  if (t.length > 600 && lines <= 3) {
    notes.push("整篇几乎没有换行，可能是 PDF 抽取时行没分开——建议手工整理一下段落。");
  }
  // 私有区字符：从网页复制时可能带进来（BOSS 的反爬字体就是这种）。
  // 写成 \u 转义而不是把字符直接放进源码——裸的私有区字符在编辑器、
  // 剪贴板和编码转换里会被静默吃掉，那时正则会退化成匹配一个普通连字符，
  // 而且从源码上完全看不出来（它本来就显示成一个短横）。
  if (/[\uE000-\uF8FF]/.test(t)) {
    notes.push("正文里有私有区字符（网页复制时常见），这些字在分析时读不出来，建议删掉或重打。");
  }
  return { chars: t.length, lines, notes };
}
