import type {
  TenderAnalysisCompletePayload,
  TenderAnalysisProgressPayload,
  TenderCategoryProgress,
  TenderParsedCategory,
  TenderParsedGroup,
  TenderParsedItem,
  TenderRequirement,
  TenderSourceTrace,
} from "../types/tender";
import { getBackendToken, getBackendUsername, requestBlob, requestJson } from "./backend-api";
const TENDER_PARSE_POLL_INTERVAL_MS = 1200;

export const TENDER_TRACE_PENDING_LOCATION = "原文定位待加载";

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
  blockId: string;
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

type BackendCategoryProgress = {
  key: string;
  label: string;
  status: TenderCategoryProgress["status"];
  itemCount: number;
};

type BackendTraceResponse = {
  item?: BackendParseItem;
  trace?: BackendParseTraceBlock[];
  chunks?: BackendParseTraceChunk[];
  parseResult?: {
    documentVersionId?: string;
  };
};

type BackendParseResultResponse = {
  status: string;
  progress: number;
  stage: string;
  categoryProgress?: BackendCategoryProgress[];
  result?: {
    summary?: string;
    majorItems?: BackendParseCategory[];
  };
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

function buildPageLabel(start?: number | null, end?: number | null) {
  if (start == null && end == null) {
    return "";
  }
  if (start != null && end != null) {
    return start === end ? `第 ${start} 页` : `第 ${start}-${end} 页`;
  }
  const page = start ?? end;
  return page != null ? `第 ${page} 页` : "";
}

function buildLocation(blocks: BackendParseTraceBlock[], chunks: BackendParseTraceChunk[]) {
  const firstBlock = blocks[0];
  const lastBlock = blocks.at(-1);
  const pageLabel = buildPageLabel(firstBlock?.pageNo, lastBlock?.pageNo);
  const paragraphLabel = firstBlock?.paragraphNo != null ? `第 ${firstBlock.paragraphNo} 段` : "";
  const sectionLabel = getLastPathSegment(firstBlock?.sectionPath ?? chunks[0]?.sectionPath);

  const composed = [pageLabel, paragraphLabel, sectionLabel].filter(Boolean).join(" / ");
  if (composed) {
    return composed;
  }

  const firstChunk = chunks[0];
  const chunkPageLabel = buildPageLabel(firstChunk?.pageStart, firstChunk?.pageEnd);
  if (chunkPageLabel) {
    return sectionLabel ? `${chunkPageLabel} / ${sectionLabel}` : chunkPageLabel;
  }

  return sectionLabel ? `章节：${sectionLabel}` : "原文定位待补充";
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
  const hasConcreteSource = blocks.length > 0 || chunks.length > 0;
  const unresolved = item.content === "未找到" && !hasConcreteSource;

  return {
    id: `${item.id}-trace`,
    outline,
    location: unresolved ? "未找到原文依据" : buildLocation(blocks, chunks),
    quote: unresolved ? "未找到" : quote,
    paragraph: unresolved ? "未找到" : paragraph,
    pageNo: firstBlock?.pageNo ?? firstChunk?.pageStart ?? null,
    documentVersionId: traceResponse.parseResult?.documentVersionId ?? null,
    sourceItemId: item.id,
    blocks: blocks.map((block) => ({
      blockId: block.blockId,
      pageNo: block.pageNo,
      paragraphNo: block.paragraphNo,
      sectionPath: block.sectionPath,
      quote: block.quote,
    })),
  };
}

function buildPendingTrace(item: BackendParseItem): TenderSourceTrace {
  return {
    id: `${item.id}-trace`,
    outline: item.normalizedValue?.sectionPath || item.title,
    location: TENDER_TRACE_PENDING_LOCATION,
    quote: item.sourceQuote || item.content,
    paragraph: item.sourceQuote || item.content,
    pageNo: null,
    documentVersionId: null,
    sourceItemId: item.id,
    blocks: [],
  };
}

const tenderTraceCache = new Map<string, TenderSourceTrace>();

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
        owner: getBackendUsername(),
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

async function pollTenderParse(
  taskId: string,
  onProgress?: (payload: TenderAnalysisProgressPayload) => void,
) {
  const token = await getBackendToken();
  let cachedCategories: TenderParsedCategory[] = [];
  let cachedSummary = "";
  let lastSnapshotKey = "";

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = await requestJson<BackendParseResultResponse>(
      `/tender/parse/status/${taskId}`,
      undefined,
      token,
    );

    const snapshotKey =
      result.result?.majorItems
        ?.map((category) => `${category.majorCode}:${category.items.map((item) => item.id).join(",")}`)
        .join("|") ?? "";

    if (result.result?.majorItems && snapshotKey !== lastSnapshotKey) {
      cachedCategories = hydrateCategories(result.result.majorItems);
      cachedSummary = result.result.summary ?? "";
      lastSnapshotKey = snapshotKey;
    }

    onProgress?.({
      progress: result.progress ?? 0,
      stage: result.stage ?? "",
      summary: result.result?.summary ?? cachedSummary,
      categories: cachedCategories,
      categoryProgress: result.categoryProgress ?? [],
    });

    if (result.status === "succeeded" || result.status === "failed") {
      return result;
    }

    await new Promise((resolve) => window.setTimeout(resolve, TENDER_PARSE_POLL_INTERVAL_MS));
  }

  throw new Error("解析轮询超时，请稍后重试。");
}

async function fetchTenderParseResult(taskId: string) {
  const token = await getBackendToken();
  return requestJson<BackendParseResultResponse>(
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

export async function fetchTenderItemTrace(itemId: string) {
  const cachedTrace = tenderTraceCache.get(itemId);
  if (cachedTrace) {
    return cachedTrace;
  }

  const traceResponse = await fetchTrace(itemId);
  const trace = traceResponse.item ? buildTrace(traceResponse.item, traceResponse) : {
    id: `${itemId}-trace`,
    outline: itemId,
    location: "页码待定位",
    quote: "",
    paragraph: "",
    pageNo: null,
    documentVersionId: traceResponse.parseResult?.documentVersionId ?? null,
    sourceItemId: itemId,
    blocks: [],
  };
  tenderTraceCache.set(itemId, trace);
  return trace;
}

export async function fetchTenderSourceDocument(documentVersionId: string) {
  const token = await getBackendToken();
  return requestBlob(
    `/tender/documents/${encodeURIComponent(documentVersionId)}/source-file`,
    undefined,
    token,
  );
}

function hydrateCategories(majorItems: BackendParseCategory[]) {
  const categories = majorItems.map((category): TenderParsedCategory => {
    const groupMap = new Map<string, TenderParsedGroup>();

    const parsedItems = category.items.map((item): TenderParsedItem => {
      const resolvedTrace = tenderTraceCache.get(item.id) ?? buildPendingTrace(item);
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        trace: resolvedTrace,
      };
    });

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
  });

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
  onProgress?: (payload: TenderAnalysisProgressPayload) => void;
}): Promise<TenderAnalysisCompletePayload> {
  const ensuredRemoteProjectId = await ensureRemoteProject(projectName, remoteProjectId);
  const upload = await uploadTenderFile(ensuredRemoteProjectId, file);
  const parse = await startTenderParse(ensuredRemoteProjectId, upload.fileId);
  const status = await pollTenderParse(parse.taskId, onProgress);

  if (status.status !== "succeeded") {
    throw new Error("招标文件解析失败，请检查后端日志。");
  }

  const parseResult = await fetchTenderParseResult(parse.taskId);
  const categories = hydrateCategories(parseResult.result?.majorItems ?? []);
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
    categoryProgress: status.categoryProgress ?? [],
    outline: buildDraftOutline(requirements),
    summary: parseResult.result?.summary ?? "",
    parsedAt,
  };
}
