import type {
  TenderAnalysisCompletePayload,
  TenderParsedCategory,
  TenderParsedGroup,
  TenderParsedItem,
  TenderRequirement,
  TenderSourceTrace,
} from "../types/tender";

const API_BASE = (import.meta.env.VITE_TENDER_BACKEND_BASE_URL ?? "http://127.0.0.1:3001/api").replace(/\/+$/, "");
const BACKEND_USERNAME = import.meta.env.VITE_TENDER_BACKEND_USERNAME ?? "admin";
const BACKEND_PASSWORD = import.meta.env.VITE_TENDER_BACKEND_PASSWORD ?? "admin123";
const TOKEN_STORAGE_KEY = "smart-bidding.backend-token";

type BackendParseItem = {
  id: string;
  minorCode: string;
  title: string;
  content: string;
  priority?: string;
  isRequired?: boolean;
  sourceQuote?: string;
  normalizedValue?: { sectionPath?: string };
};

type BackendParseCategory = {
  majorCode: string;
  majorName: string;
  items: BackendParseItem[];
};

type BackendParseTraceBlock = {
  pageNo: number | null;
  sectionPath?: string | null;
  paragraphNo?: number | null;
  quote?: string | null;
};

type BackendParseTraceChunk = {
  sectionPath?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  text?: string | null;
};

type BackendTraceResponse = {
  trace?: BackendParseTraceBlock[];
  chunks?: BackendParseTraceChunk[];
};

const MAJOR_CODE_TO_KEY: Record<string, string> = {
  basic_info: "basic",
  qualification_requirements: "qualify",
  review_requirements: "review",
  bid_document_requirements: "bidDoc",
  invalid_and_rejection: "invalid",
  required_submission_documents: "submit",
  tender_document_review: "clause",
  other: "other",
};

function toRequirementPriority(value?: string): TenderRequirement["priority"] {
  if (value === "high" || value === "low") {
    return value;
  }
  return "medium";
}

function buildDraftOutline(requirements: TenderRequirement[]) {
  return [
    "投标大纲：",
    ...requirements.slice(0, 8).map((item, index) => `${index + 1}. ${item.title}`),
  ].join("\n");
}

function sanitizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function getLastPathSegment(value?: string | null) {
  if (!value) return "";
  return value
    .split(/>|\/|\\|::/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function buildLocation(blocks: BackendParseTraceBlock[], chunks: BackendParseTraceChunk[]) {
  const firstBlock = blocks[0];
  if (firstBlock?.pageNo != null) {
    const paragraph = firstBlock.paragraphNo != null ? ` / 第 ${firstBlock.paragraphNo} 段` : "";
    return `第 ${firstBlock.pageNo} 页${paragraph}`;
  }

  const firstChunk = chunks[0];
  if (firstChunk?.pageStart != null && firstChunk?.pageEnd != null) {
    if (firstChunk.pageStart === firstChunk.pageEnd) {
      return `第 ${firstChunk.pageStart} 页`;
    }
    return `第 ${firstChunk.pageStart}-${firstChunk.pageEnd} 页`;
  }

  return "原文定位待补充";
}

function buildTrace(item: BackendParseItem, traceResponse: BackendTraceResponse): TenderSourceTrace {
  const blocks = traceResponse.trace ?? [];
  const chunks = traceResponse.chunks ?? [];
  const firstBlock = blocks[0];
  const firstChunk = chunks[0];
  const outline =
    firstBlock?.sectionPath ||
    firstChunk?.sectionPath ||
    item.normalizedValue?.sectionPath ||
    item.title;
  const quote =
    firstBlock?.quote ||
    item.sourceQuote ||
    item.content;
  const paragraph =
    firstChunk?.text ||
    blocks.map((entry) => entry.quote).filter(Boolean).join("\n") ||
    quote;

  return {
    id: `${item.id}-trace`,
    outline,
    location: buildLocation(blocks, chunks),
    quote,
    paragraph,
  };
}

async function requestJson<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function getBackendToken() {
  const cached = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (cached) {
    return cached;
  }

  const result = await requestJson<{ token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: BACKEND_USERNAME,
      password: BACKEND_PASSWORD,
    }),
  });

  sessionStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  return result.token;
}

async function ensureRemoteProject(projectName: string, remoteProjectId?: string | null) {
  if (remoteProjectId) {
    return remoteProjectId;
  }

  const token = await getBackendToken();
  const result = await requestJson<{ project: { id: string } }>(
    "/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: projectName,
        owner: BACKEND_USERNAME,
        type: "智能标书库",
      }),
    },
    token,
  );

  return result.project.id;
}

async function uploadTenderFile(remoteProjectId: string, file: File) {
  const token = await getBackendToken();
  const formData = new FormData();
  formData.append("projectId", remoteProjectId);
  formData.append("file", file);

  return requestJson<{ fileId: string }>("/tender/upload", {
    method: "POST",
    body: formData,
  }, token);
}

async function startTenderParse(remoteProjectId: string, remoteFileId: string) {
  const token = await getBackendToken();
  return requestJson<{ taskId: string }>("/tender/parse", {
    method: "POST",
    body: JSON.stringify({
      projectId: remoteProjectId,
      fileId: remoteFileId,
    }),
  }, token);
}

async function pollTenderParse(taskId: string, onProgress?: (progress: number, stage: string) => void) {
  const token = await getBackendToken();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await requestJson<{ status: string; progress: number; stage: string }>(
      `/tender/parse/status/${taskId}`,
      undefined,
      token,
    );

    onProgress?.(result.progress ?? 0, result.stage ?? "");
    if (result.status === "succeeded" || result.status === "failed") {
      return result;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }

  throw new Error("解析轮询超时，请稍后重试。");
}

async function fetchTenderParseResult(taskId: string) {
  const token = await getBackendToken();
  return requestJson<{ result?: { summary?: string; majorItems?: BackendParseCategory[] } }>(
    `/tender/parse/result?taskId=${encodeURIComponent(taskId)}`,
    undefined,
    token,
  );
}

async function fetchTrace(itemId: string) {
  const token = await getBackendToken();
  return requestJson<BackendTraceResponse>(
    `/tender/parse/items/${encodeURIComponent(itemId)}/trace`,
    undefined,
    token,
  );
}

async function hydrateCategories(majorItems: BackendParseCategory[]) {
  const categories = await Promise.all(
    majorItems.map(async (category): Promise<TenderParsedCategory> => {
      const groupMap = new Map<string, TenderParsedGroup>();

      const parsedItems = await Promise.all(
        category.items.map(async (item): Promise<TenderParsedItem> => {
          const traceResponse = await fetchTrace(item.id);
          return {
            id: item.id,
            title: item.title,
            content: item.content,
            trace: buildTrace(item, traceResponse),
          };
        }),
      );

      parsedItems.forEach((item, index) => {
        const groupLabel = getLastPathSegment(item.trace.outline) || `解析结果 ${index + 1}`;
        const groupKey = sanitizeKey(groupLabel || `${category.majorCode}-${index + 1}`);
        const currentGroup = groupMap.get(groupKey);
        if (currentGroup) {
          currentGroup.items.push(item);
          return;
        }
        groupMap.set(groupKey, {
          key: groupKey,
          label: groupLabel,
          items: [item],
        });
      });

      return {
        key: MAJOR_CODE_TO_KEY[category.majorCode] ?? category.majorCode,
        label: category.majorName,
        groups: Array.from(groupMap.values()),
      };
    }),
  );

  const orderedKeys = ["basic", "qualify", "review", "bidDoc", "invalid", "submit", "clause", "other"];
  return categories.sort(
    (left, right) => orderedKeys.indexOf(left.key) - orderedKeys.indexOf(right.key),
  );
}

function buildRequirements(categories: TenderParsedCategory[]): TenderRequirement[] {
  return categories.flatMap((category) =>
    category.groups.flatMap((group) =>
      group.items.map((item, index) => ({
        id: item.id,
        sectionId: `${category.key}-${group.key}-${index + 1}`,
        title: item.title,
        description: item.content,
        priority: toRequirementPriority(index === 0 ? "high" : "medium"),
        required: category.key !== "other",
      })),
    ),
  );
}

export async function runTenderAnalysisWorkflow({
  projectName,
  remoteProjectId,
  file,
  onProgress,
}: {
  projectName: string;
  remoteProjectId?: string | null;
  file: File;
  onProgress?: (progress: number, stage: string) => void;
}): Promise<TenderAnalysisCompletePayload> {
  const ensuredRemoteProjectId = await ensureRemoteProject(projectName, remoteProjectId);
  const upload = await uploadTenderFile(ensuredRemoteProjectId, file);
  const parse = await startTenderParse(ensuredRemoteProjectId, upload.fileId);
  const status = await pollTenderParse(parse.taskId, onProgress);

  if (status.status !== "succeeded") {
    throw new Error("招标文件解析失败，请检查后端日志。");
  }

  const parseResult = await fetchTenderParseResult(parse.taskId);
  const categories = await hydrateCategories(parseResult.result?.majorItems ?? []);
  const requirements = buildRequirements(categories);
  const parsedAt = new Date().toISOString();

  return {
    remoteProjectId: ensuredRemoteProjectId,
    remoteFileId: upload.fileId,
    remoteTaskId: parse.taskId,
    uploadedTender: {
      name: file.name,
      size: `${(file.size / 1024).toFixed(2)} KB`,
      format: file.name.split(".").at(-1)?.toUpperCase() ?? "FILE",
    },
    requirements,
    categories,
    outline: buildDraftOutline(requirements),
    summary: parseResult.result?.summary ?? "",
    parsedAt,
  };
}
