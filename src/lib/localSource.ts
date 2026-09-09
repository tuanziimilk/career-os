// 本地文件数据源：直接读 jd-insight 扩展导出的 JSON（data/jd_backup.json），
// 用 File System Access API 授权一次某个文件夹，之后可持续读。
//
// 这条路径给的是"不接后端也能看真实数据"——在 Supabase 还没连、
// 或者你就是不想把数据传上云的时候，用它。
import type {
  CapabilityRow,
  InterviewQuestion,
  JobRecord,
  LearningModule,
  DataSource,
  Status,
} from "./types";
import { unsupportedWrite } from "./types";

// 扩展导出的原始记录结构（对应 popup.js 的 toBlock / content.js 的 extract）
interface RawJdRecord {
  key: string;
  title?: string;
  company?: string;
  salary?: string;
  tagline?: string;
  url?: string;
  site?: string;
  intent?: string;
  status?: string;
  failReason?: string;
  statusHistory?: { status: string; at: string }[];
  ts?: string;
}

function normalize(raw: RawJdRecord): JobRecord {
  return {
    key: raw.key,
    title: raw.title || "（无标题）",
    company: raw.company || "—",
    salary: raw.salary || "",
    tagline: raw.tagline || "",
    url: raw.url || "",
    site: raw.site || "",
    intent: (raw.intent as JobRecord["intent"]) || "",
    status: (raw.status as Status) || "",
    failReason: raw.failReason,
    statusHistory: (raw.statusHistory || []).map((h) => ({
      status: (h.status as Status) || "",
      at: h.at,
    })),
    ts: raw.ts || new Date().toISOString().slice(0, 19).replace("T", " "),
  };
}

const DB_NAME = "career-os";
const STORE = "handles";
const HANDLE_KEY = "dataDir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

let cachedHandle: FileSystemDirectoryHandle | null = null;

/** 首次调用会弹出目录选择器，选 jd-insight/data/ 那个文件夹 */
export async function connectLocalFolder(): Promise<boolean> {
  if (!("showDirectoryPicker" in window)) {
    alert("这个浏览器不支持本地文件夹访问（需要 Chrome/Edge），请用 Chrome 打开。");
    return false;
  }
  try {
    // @ts-expect-error showDirectoryPicker 尚未进入部分 TS lib 版本
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
      id: "career-os-data",
      mode: "read",
    });
    cachedHandle = handle;
    await saveHandle(handle);
    return true;
  } catch {
    return false; // 用户取消选择
  }
}

async function getHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedHandle) return cachedHandle;
  const h = await loadHandle();
  if (!h) return null;
  // 权限可能过期，需要重新确认（用户上次授权后浏览器可能已收回）
  // @ts-expect-error queryPermission 属实验性 API
  const perm = await h.queryPermission?.({ mode: "read" });
  if (perm !== "granted") {
    // @ts-expect-error requestPermission 属实验性 API
    const req = await h.requestPermission?.({ mode: "read" });
    if (req !== "granted") return null;
  }
  cachedHandle = h;
  return h;
}

async function readJsonFile<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    const text = await file.text();
    return JSON.parse(text) as T;
  } catch {
    return null; // 文件不存在或格式不对——上层要有兜底，不能崩
  }
}

export function isLocalConnected(): Promise<boolean> {
  return getHandle().then((h) => h != null);
}

export const localSource: DataSource = {
  kind: "local",
  label: "本地文件",
  async getJobs(): Promise<JobRecord[]> {
    const dir = await getHandle();
    if (!dir) return [];
    const raw = (await readJsonFile<RawJdRecord[]>(dir, "jd_backup.json")) || [];
    return raw.map(normalize);
  },
  // 本地数据源目前只覆盖投递页需要的 jobs；能力画像/学习/刷题
  // 仍走各自的静态资料（learningData / questionsData），本地源不重复维护。
  async getCapabilities(): Promise<CapabilityRow[]> {
    return [];
  },
  async getLearning(): Promise<LearningModule[]> {
    return [];
  },
  async getQuestions(): Promise<InterviewQuestion[]> {
    return [];
  },
  // File System Access API 的 read 权限授权拿不到并发写保护，
  // 勉强实现写入容易在多标签页场景下互相覆盖——所以本地源统一不支持写，
  // 想要能编辑的数据就切换到云端数据源。
  // 本地备份文件里只有 JD，没有学习活动记录——返回空，界面显示"还没有记录"
  getActivityDays: () => Promise.resolve([]),

  upsertJob: () => Promise.resolve(unsupportedWrite("local")),
  appendStatus: () => Promise.resolve(unsupportedWrite("local")),
  setFailReason: () => Promise.resolve(unsupportedWrite("local")),
  setLearningStatus: () => Promise.resolve(unsupportedWrite("local")),
  setQuestionResult: () => Promise.resolve(unsupportedWrite("local")),
  updateCapabilities: () => Promise.resolve(unsupportedWrite("local")),
};
