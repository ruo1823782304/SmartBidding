import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(__dirname, "..", "data");
const PROPOSALS_FILE = path.join(DATA_DIR, "proposals.json");
const SNIPPETS_FILE = path.join(DATA_DIR, "proposal-snippets.json");

export interface StoredProposal {
  id: string;
  name: string;
  /** 整份标书的纯文本或 Markdown 文本 */
  content: string;
  createdAt: string;
}

export interface SectionSnippet {
  /** 例如 "tech.overall-architecture" */
  sectionKey: string;
  /** 人类可读标题，比如 "第三部分 技术标 / 总体架构设计" */
  sectionTitle: string;
  /** 从多份标书中提炼出来的多种表达方式 */
  examples: string[];
}

export interface SnippetLibrary {
  updatedAt: string;
  outlineNote?: string;
  sections: SectionSnippet[];
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadProposals(): StoredProposal[] {
  ensureDataDir();
  if (!fs.existsSync(PROPOSALS_FILE)) return [];
  try {
    const raw = fs.readFileSync(PROPOSALS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[libraryStore] 读取 proposals.json 失败，将返回空数组：", err);
    return [];
  }
}

export function saveProposals(list: StoredProposal[]) {
  ensureDataDir();
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(list, null, 2), "utf8");
}

export function appendProposal(name: string, content: string): StoredProposal {
  const list = loadProposals();
  const proposal: StoredProposal = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    content,
    createdAt: new Date().toISOString(),
  };
  list.push(proposal);
  saveProposals(list);
  return proposal;
}

export function loadSnippetLibrary(): SnippetLibrary | null {
  ensureDataDir();
  if (!fs.existsSync(SNIPPETS_FILE)) return null;
  try {
    const raw = fs.readFileSync(SNIPPETS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[libraryStore] 读取 proposal-snippets.json 失败：", err);
    return null;
  }
}

export function saveSnippetLibrary(lib: SnippetLibrary) {
  ensureDataDir();
  fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(lib, null, 2), "utf8");
}

