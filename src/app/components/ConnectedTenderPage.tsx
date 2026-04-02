import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  fetchTenderItemTrace,
  fetchTenderSourceDocument,
  runTenderAnalysisWorkflow,
  TENDER_TRACE_PENDING_LOCATION,
} from "../lib/tender-workflow";
import {
  buildBasicInfoView,
  findTenderCategory,
  pickCategoryGroups,
  pickDefaultTrace,
  type TenderSubTabDefinition,
  type TenderTraceValue,
} from "../lib/tender-analysis-view";
import type {
  TenderAnalysisCompletePayload,
  TenderCategoryProgress,
  TenderParsedCategory,
  TenderParsedGroup,
  TenderParsedItem,
  TenderSourceTrace,
  TenderSourceTraceBlock,
} from "../types/tender";

type ConnectedTenderPageProps = {
  projectName: string;
  remoteProjectId?: string | null;
  initialUploadedTender?: { name: string; size: string; format: string } | null;
  initialCategories?: TenderParsedCategory[];
  onAnalysisComplete: (payload: TenderAnalysisCompletePayload) => void;
  onAnalysisUiChange?: (snapshot: {
    isAnalyzing: boolean;
    isReady: boolean;
    progress: number;
    stage: string;
  }) => void;
};

const TOP_LEVEL_TABS = [
  { key: "basic", label: "基础信息" },
  { key: "qualify", label: "资格要求" },
  { key: "review", label: "评审要求" },
  { key: "bidDoc", label: "投标文件要求" },
  { key: "invalid", label: "无效标与废标项" },
  { key: "submit", label: "应标需提交文件" },
  { key: "clause", label: "招标文件审查" },
] as const;

const REVIEW_SUB_TABS: TenderSubTabDefinition[] = [
  { key: "score", label: "评分标准", keywords: ["评分", "分值", "打分", "标准"] },
  { key: "open", label: "开标", keywords: ["开标", "唱标", "开启"] },
  { key: "eval", label: "评标", keywords: ["评标", "评审", "评委"] },
  { key: "decide", label: "定标", keywords: ["定标", "推荐中标", "候选人"] },
  { key: "win", label: "中标要求", keywords: ["中标", "履约", "通知书"] },
] as const;

const BID_DOC_SUB_TABS: TenderSubTabDefinition[] = [
  { key: "compose", label: "投标文件的组成", keywords: ["组成", "商务标", "技术标", "报价"] },
  { key: "prep", label: "投标文件的编制", keywords: ["编制", "格式", "签字", "盖章"] },
  { key: "seal", label: "投标文件的密封和标记", keywords: ["密封", "标记", "封装"] },
  { key: "submit", label: "投标文件的递交", keywords: ["递交", "送达", "提交"] },
  { key: "modify", label: "投标文件的修改与撤回", keywords: ["修改", "撤回", "补充"] },
  { key: "validity", label: "投标有效期", keywords: ["有效期", "有效"] },
] as const;

const INVALID_SUB_TABS: TenderSubTabDefinition[] = [
  { key: "invalid", label: "废标项", keywords: ["废标", "废标项"] },
  { key: "forbid", label: "不得存在的情形", keywords: ["不得", "禁止", "存在的情形"] },
  { key: "reject", label: "否决和无效投标情形", keywords: ["否决", "无效投标", "拒绝"] },
] as const;

const CLAUSE_SUB_TABS: TenderSubTabDefinition[] = [
  { key: "term", label: "条款风险", keywords: ["条款", "风险", "冲突", "不明确"] },
  { key: "fair", label: "公平性审查风险", keywords: ["公平", "限制", "排他", "审查"] },
] as const;

function buildUploadedTenderKey(file?: { name: string; size: string; format: string } | null) {
  if (!file) return "";
  return `${file.name}|${file.size}|${file.format}`;
}

function getEmptyStateText(label: string) {
  return `${label} 暂未识别到明确内容`;
}

function buildCategoryProgressState(categories: TenderParsedCategory[] = []): TenderCategoryProgress[] {
  const completedKeys = new Set(
    categories.filter((category) => category.groups.some((group) => group.items.length > 0)).map((category) => category.key),
  );

  return TOP_LEVEL_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    status: completedKeys.has(tab.key) ? "completed" : "pending",
    itemCount:
      categories.find((category) => category.key === tab.key)?.groups.reduce((total, group) => total + group.items.length, 0) ?? 0,
  }));
}

function mergeCategoryProgressState(progress: TenderCategoryProgress[]): TenderCategoryProgress[] {
  const progressMap = new Map(progress.map((item) => [item.key, item]));
  return TOP_LEVEL_TABS.map((tab) => {
    const current = progressMap.get(tab.key);
    return {
      key: tab.key,
      label: current?.label ?? tab.label,
      status: current?.status ?? "pending",
      itemCount: current?.itemCount ?? 0,
    };
  });
}

function renderCategoryStatusIndicator(status: TenderCategoryProgress["status"]) {
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  }

  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#165DFF]" />;
  }

  if (status === "failed") {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F56C6C]" />;
  }

  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#C0C4CC]" />;
}

function replaceTraceInCategories(
  categories: TenderParsedCategory[],
  sourceItemId: string,
  nextTrace: TenderSourceTrace,
) {
  return categories.map((category) => ({
    ...category,
    groups: category.groups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.id === sourceItemId
          ? {
              ...item,
              trace: nextTrace,
            }
          : item,
      ),
    })),
  }));
}

function TraceValueButton({
  value,
  onSelect,
}: {
  value: TenderTraceValue;
  onSelect: (trace: TenderSourceTrace) => void;
}) {
  if (!value.trace || !value.text || value.text === "—" || value.text === "未找到") {
    return <span className="text-[#909399]">{value.text || "—"}</span>;
  }

  return (
    <button
      type="button"
      className="text-left text-[#165DFF] hover:underline"
      onClick={() => onSelect(value.trace!)}
    >
      {value.text}
    </button>
  );
}

function ParsedItemsBlock({
  groups,
  emptyText,
  onSelectTrace,
}: {
  groups: TenderParsedGroup[];
  emptyText: string;
  onSelectTrace: (trace: TenderSourceTrace) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-[8px] border border-[#E4E7ED] bg-[#FAFAFA] px-4 py-6 text-sm text-[#909399]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="rounded-[8px] border border-[#E4E7ED] bg-white">
          <div className="border-b border-[#E4E7ED] bg-[#F7FAFF] px-4 py-3">
            <p className="text-sm font-medium text-[#303133]">{group.label}</p>
          </div>
          <div className="space-y-3 p-4">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full rounded-[8px] border border-[#E4E7ED] px-3 py-3 text-left hover:border-[#165DFF] hover:bg-[#F7FAFF]"
                onClick={() => onSelectTrace(item.trace)}
              >
                <p className="text-sm font-medium text-[#303133]">{item.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#606266]">{item.content}</p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type SourcePreviewKind = "pdf" | "docx" | "text" | "unsupported";

type LoadedSourcePreview = {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  contentType: string;
  kind: SourcePreviewKind;
  textContent?: string;
};

const sourcePreviewCache = new Map<string, LoadedSourcePreview>();

function parseResponseFileName(response: Response) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8Matched = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Matched?.[1]) {
    return decodeURIComponent(utf8Matched[1]);
  }

  const plainMatched = disposition.match(/filename="?([^"]+)"?/i);
  if (plainMatched?.[1]) {
    return plainMatched[1];
  }

  return "招标原文";
}

function resolvePreviewKind(contentType: string, fileName: string): SourcePreviewKind {
  const lowerType = contentType.toLowerCase();
  const lowerName = fileName.toLowerCase();

  if (lowerType.includes("pdf") || lowerName.endsWith(".pdf")) {
    return "pdf";
  }

  if (lowerType.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    return "docx";
  }

  if (lowerType.startsWith("text/") || lowerName.endsWith(".txt")) {
    return "text";
  }

  return "unsupported";
}

function normalizeTraceMatch(value?: string | null) {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function getTraceSectionLabel(trace: TenderSourceTrace) {
  const value = trace.blocks?.find((block) => block.sectionPath?.trim())?.sectionPath ?? trace.outline;
  if (!value) {
    return "";
  }
  return value
    .split(/>|\/|\\|::/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1) ?? "";
}

function buildTraceTargets(trace: TenderSourceTrace) {
  const values = [
    ...(trace.blocks ?? []).map((block) => block.quote ?? ""),
    trace.quote,
    trace.paragraph,
  ];
  const seen = new Set<string>();
  const targets: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeTraceMatch(value).slice(0, 400);
    if (normalized.length < 12 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    targets.push(normalized);
  });
  return targets;
}

function buildNgramSet(text: string, size = 6) {
  if (!text) {
    return new Set<string>();
  }
  if (text.length <= size) {
    return new Set([text]);
  }

  const grams = new Set<string>();
  for (let index = 0; index <= text.length - size; index += 1) {
    grams.add(text.slice(index, index + size));
  }
  return grams;
}

function scoreTraceText(nodeText: string, target: string) {
  if (!nodeText || !target) {
    return 0;
  }

  if (nodeText === target) {
    return 1000;
  }
  if (nodeText.includes(target)) {
    return 800 + Math.min(target.length, 200);
  }
  if (target.includes(nodeText) && nodeText.length >= 18) {
    return 500 + Math.min(nodeText.length, 120);
  }

  const targetGrams = buildNgramSet(target);
  if (targetGrams.size === 0) {
    return 0;
  }

  const nodeGrams = buildNgramSet(nodeText);
  let overlap = 0;
  targetGrams.forEach((gram) => {
    if (nodeGrams.has(gram)) {
      overlap += 1;
    }
  });

  return (overlap / targetGrams.size) * 100;
}

function clearDocxHighlights(container: HTMLDivElement) {
  Array.from(container.querySelectorAll<HTMLElement>("[data-trace-highlight='true']")).forEach((node) => {
    node.style.backgroundColor = "";
    node.style.boxShadow = "";
    node.removeAttribute("data-trace-highlight");
  });
}

function collectDocxRenderableNodes(container: HTMLDivElement) {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("p, li, td, th, h1, h2, h3, h4, h5, h6, span, div"));
  return nodes.filter((node) => {
    const text = normalizeTraceMatch(node.textContent);
    if (text.length < 12) {
      return false;
    }

    const strongestChildText = Array.from(node.children).reduce((max, child) => {
      return Math.max(max, normalizeTraceMatch(child.textContent).length);
    }, 0);

    return strongestChildText < text.length;
  });
}

function collectDocxPageElements(container: HTMLDivElement) {
  const pages = Array.from(
    container.querySelectorAll<HTMLElement>(".docx-wrapper > section, .docx-wrapper > div.docx, section.docx, div.docx"),
  ).filter((node) => normalizeTraceMatch(node.textContent).length > 0);

  return Array.from(new Set(pages));
}

function resolveDocxPreviewPage(container: HTMLDivElement, node: HTMLElement) {
  const pages = collectDocxPageElements(container);
  if (pages.length === 0) {
    return null;
  }

  const directPage = node.closest("section.docx, div.docx");
  if (directPage instanceof HTMLElement) {
    const pageIndex = pages.indexOf(directPage);
    if (pageIndex >= 0) {
      return pageIndex + 1;
    }
  }

  const fallbackIndex = pages.findIndex((page) => page.contains(node));
  return fallbackIndex >= 0 ? fallbackIndex + 1 : null;
}

function buildResolvedTraceLocation(trace: TenderSourceTrace, previewPageNo?: number | null) {
  const firstBlock: TenderSourceTraceBlock | undefined = trace.blocks?.[0];
  const pageLabel =
    previewPageNo != null
      ? trace.pageNo != null && trace.pageNo !== previewPageNo
        ? `第 ${previewPageNo} 页（预览定位）`
        : `第 ${previewPageNo} 页`
      : trace.pageNo != null
        ? `第 ${trace.pageNo} 页`
        : "";
  const paragraphLabel = firstBlock?.paragraphNo != null ? `第 ${firstBlock.paragraphNo} 段` : "";
  const sectionLabel = getTraceSectionLabel(trace);
  const composed = [pageLabel, paragraphLabel, sectionLabel].filter(Boolean).join(" / ");
  return composed || trace.location;
}

function highlightDocxMatch(container: HTMLDivElement, trace: TenderSourceTrace) {
  clearDocxHighlights(container);
  const targets = buildTraceTargets(trace);
  if (targets.length === 0) {
    return { matched: false, previewPageNo: null as number | null };
  }

  const nodes = collectDocxRenderableNodes(container);
  const matchedNodes: HTMLElement[] = [];

  targets.slice(0, 3).forEach((target) => {
    let bestNode: HTMLElement | null = null;
    let bestScore = 0;

    nodes.forEach((node) => {
      if (matchedNodes.includes(node)) {
        return;
      }
      const score = scoreTraceText(normalizeTraceMatch(node.textContent), target);
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });

    if (bestNode && bestScore >= 26) {
      matchedNodes.push(bestNode);
    }
  });

  if (matchedNodes.length === 0) {
    return { matched: false, previewPageNo: null as number | null };
  }

  matchedNodes.forEach((node, index) => {
    node.style.backgroundColor = index === 0 ? "#EEF4FF" : "#F5F7FA";
    node.style.boxShadow = "0 0 0 1px rgba(22, 93, 255, 0.18) inset";
    node.setAttribute("data-trace-highlight", "true");
  });

  matchedNodes[0].scrollIntoView({ block: "center", behavior: "smooth" });
  return {
    matched: true,
    previewPageNo: resolveDocxPreviewPage(container, matchedNodes[0]),
  };
}

function TracePanel({ trace }: { trace: TenderSourceTrace | null }) {
  return (
    <div className="flex flex-col rounded-[8px] border border-[#E4E7ED] bg-white">
      <div className="border-b border-[#E4E7ED] px-4 py-3">
        <h4 className="text-sm font-medium text-[#303133]">招标原文定位</h4>
        <p className="mt-1 text-xs text-[#909399]">每一条解析内容都可以回溯到原文中的对应段落。</p>
      </div>
      <div className="space-y-4 p-4">
        <div className="rounded-[8px] bg-[#F7FAFF] p-3">
          <p className="text-xs text-[#909399]">大纲路径</p>
          <p className="mt-1 text-sm leading-6 text-[#303133]">{trace?.outline ?? "—"}</p>
        </div>
        <div className="rounded-[8px] bg-[#F7FAFF] p-3">
          <p className="text-xs text-[#909399]">原文定位</p>
          <p className="mt-1 text-sm leading-6 text-[#303133]">{trace?.location ?? "—"}</p>
        </div>
        <div className="rounded-[8px] bg-[#F7FAFF] p-3">
          <p className="text-xs text-[#909399]">原文摘录</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#303133]">
            {trace?.quote ?? "—"}
          </p>
        </div>
        <div className="rounded-[8px] bg-[#F7FAFF] p-3">
          <p className="text-xs text-[#909399]">原文上下文</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#303133]">
            {trace?.paragraph ?? "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function SourceTracePanel({ trace }: { trace: TenderSourceTrace | null }) {
  const [previewState, setPreviewState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; preview: LoadedSourcePreview }
  >({ status: "idle" });
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    if (!trace?.documentVersionId) {
      setPreviewState({ status: "idle" });
      return () => {
        disposed = true;
      };
    }

    const cachedPreview = sourcePreviewCache.get(trace.documentVersionId);
    if (cachedPreview) {
      setPreviewState({ status: "ready", preview: cachedPreview });
      return () => {
        disposed = true;
      };
    }

    setPreviewState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetchTenderSourceDocument(trace.documentVersionId!);
        const blob = await response.blob();
        const fileName = parseResponseFileName(response);
        const contentType = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
        const kind = resolvePreviewKind(contentType, fileName);
        const preview: LoadedSourcePreview = {
          blob,
          blobUrl: URL.createObjectURL(blob),
          fileName,
          contentType,
          kind,
          textContent: kind === "text" ? await blob.text() : undefined,
        };

        sourcePreviewCache.set(trace.documentVersionId!, preview);
        if (!disposed) {
          setPreviewState({ status: "ready", preview });
        }
      } catch (error) {
        if (!disposed) {
          setPreviewState({
            status: "error",
            message: error instanceof Error ? error.message : "原文加载失败",
          });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [trace?.documentVersionId]);

  useEffect(() => {
    setResolvedLocation(null);
  }, [trace?.id, trace?.documentVersionId]);

  useEffect(() => {
    let disposed = false;

    if (previewState.status !== "ready" || previewState.preview.kind !== "docx" || !docxContainerRef.current) {
      return () => {
        disposed = true;
      };
    }

    const container = docxContainerRef.current;
    container.innerHTML = "";

    void (async () => {
      const { renderAsync } = await import("docx-preview");
      if (disposed) {
        return;
      }

      await renderAsync(previewState.preview.blob, container, undefined, {
        inWrapper: true,
        breakPages: true,
        ignoreWidth: false,
        ignoreHeight: false,
      });

      if (!disposed && trace) {
        const match = highlightDocxMatch(container, trace);
        setResolvedLocation(buildResolvedTraceLocation(trace, match.previewPageNo));
      }
    })();

    return () => {
      disposed = true;
      container.innerHTML = "";
    };
  }, [previewState, trace]);

  const readyPreview = previewState.status === "ready" ? previewState.preview : null;
  const isResolvingTrace = Boolean(
    trace?.sourceItemId && trace.location === TENDER_TRACE_PENDING_LOCATION && !trace.documentVersionId,
  );

  return (
    <div className="flex flex-col rounded-[8px] border border-[#E4E7ED] bg-white">
      <div className="border-b border-[#E4E7ED] px-4 py-3">
        <h4 className="text-sm font-medium text-[#303133]">原文定位</h4>
        <p className="mt-1 text-xs text-[#909399]">直接展示原文件版式，便于核对当前解析项的原文位置。</p>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-[#F7FAFF] p-3">
          <div>
            <p className="text-xs text-[#909399]">原文定位</p>
            <p className="mt-1 text-sm font-medium leading-6 text-[#303133]">
              {resolvedLocation ?? trace?.location ?? "未定位"}
            </p>
          </div>
          {readyPreview && (
            <a
              href={readyPreview.blobUrl}
              target="_blank"
              rel="noreferrer"
              download={readyPreview.fileName}
              className="inline-flex h-9 items-center rounded-[8px] border border-[#D0D7E2] bg-white px-3 text-sm text-[#303133] transition hover:border-[#165DFF] hover:text-[#165DFF]"
            >
              打开原文件
            </a>
          )}
        </div>

        <div className="overflow-hidden rounded-[8px] border border-[#E4E7ED] bg-[#FAFAFA]">
          {previewState.status === "loading" && (
            <div className="flex min-h-[520px] items-center justify-center gap-2 text-sm text-[#606266]">
              <Loader2 className="h-4 w-4 animate-spin text-[#165DFF]" />
              原文加载中
            </div>
          )}

          {previewState.status === "error" && (
            <div className="flex min-h-[520px] items-center justify-center px-6 text-center text-sm text-[#909399]">
              {previewState.message}
            </div>
          )}

          {previewState.status === "idle" && (
            <div className="flex min-h-[520px] items-center justify-center px-6 text-center text-sm text-[#909399]">
              {isResolvingTrace ? "原文定位加载中，请稍候。" : "请选择左侧解析内容后查看原文定位。"}
            </div>
          )}

          {readyPreview?.kind === "pdf" && (
            <iframe
              title="原文预览"
              src={`${readyPreview.blobUrl}#page=${trace?.pageNo ?? 1}`}
              className="h-[720px] w-full bg-white"
            />
          )}

          {readyPreview?.kind === "docx" && (
            <div className="h-[720px] overflow-auto bg-[#F5F7FA] p-4">
              <div ref={docxContainerRef} className="mx-auto max-w-[920px]" />
            </div>
          )}

          {readyPreview?.kind === "text" && (
            <div className="h-[720px] overflow-auto bg-white p-4">
              <pre className="whitespace-pre-wrap text-sm leading-6 text-[#303133]">{readyPreview.textContent}</pre>
            </div>
          )}

          {readyPreview?.kind === "unsupported" && (
            <div className="flex min-h-[520px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-[#606266]">
              <p>当前文件格式暂不支持在线原版预览。</p>
              <p className="text-xs text-[#909399]">目前已支持 PDF、DOCX、TXT 原文版式预览。</p>
              <a
                href={readyPreview.blobUrl}
                target="_blank"
                rel="noreferrer"
                download={readyPreview.fileName}
                className="inline-flex h-9 items-center rounded-[8px] bg-[#165DFF] px-4 text-sm text-white transition hover:bg-[#0E4FCC]"
              >
                下载原文件
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BasicInfoPanel({
  category,
  selectedTrace,
  onSelectTrace,
}: {
  category?: TenderParsedCategory;
  selectedTrace: TenderSourceTrace | null;
  onSelectTrace: (trace: TenderSourceTrace) => void;
}) {
  const [basicSubTab, setBasicSubTab] = useState<"tender" | "project" | "time" | "other" | "purchase">("tender");
  const basicInfoView = useMemo(() => buildBasicInfoView(category), [category]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col rounded-[8px] border border-[#E4E7ED] bg-white">
        <Tabs value={basicSubTab} onValueChange={(value) => setBasicSubTab(value as typeof basicSubTab)} className="flex-1">
          <TabsList className="mb-3 w-full justify-start rounded-[8px] bg-[#F0F2F5] p-1">
            <TabsTrigger value="tender" className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white">招标人/代理信息</TabsTrigger>
            <TabsTrigger value="project" className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white">项目信息</TabsTrigger>
            <TabsTrigger value="time" className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white">关键时间/内容</TabsTrigger>
            <TabsTrigger value="other" className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white">其他信息</TabsTrigger>
            <TabsTrigger value="purchase" className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white">采购要求</TabsTrigger>
          </TabsList>
          <p className="mb-3 text-xs text-[#909399]">以下内容由 AI 解析生成，仅供参考，请结合右侧原文复核。</p>

          <TabsContent value="tender" className="mt-0 space-y-4">
            <div>
              <p className="mb-1 text-sm font-medium text-[#303133]">招标人</p>
              <div className="rounded-[8px] border border-[#E4E7ED] bg-[#FAFAFA] px-3 py-2 text-sm">
                <TraceValueButton value={basicInfoView.tenderName} onSelect={onSelectTrace} />
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[#303133]">招标人联系方式</p>
              <div className="overflow-x-auto rounded-[8px] border border-[#E4E7ED]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[#303133]">标题</TableHead>
                      <TableHead className="text-[#303133]">内容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {basicInfoView.tenderContacts.map((field) => (
                      <TableRow key={field.label}>
                        <TableCell>{field.label}</TableCell>
                        <TableCell>
                          <TraceValueButton value={field.value} onSelect={onSelectTrace} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[#303133]">项目联系方式</p>
              <div className="overflow-x-auto rounded-[8px] border border-[#E4E7ED]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[#303133]">名称</TableHead>
                      <TableHead className="text-[#303133]">联系电话</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {basicInfoView.projectContacts.map((row, index) => (
                      <TableRow key={index}>
                        <TableCell><TraceValueButton value={row.name} onSelect={onSelectTrace} /></TableCell>
                        <TableCell><TraceValueButton value={row.phone} onSelect={onSelectTrace} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="project" className="mt-0">
            <div className="overflow-x-auto rounded-[8px] border border-[#E4E7ED]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[#303133]">标题</TableHead>
                    <TableHead className="text-[#303133]">内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {basicInfoView.projectFields.map((field) => (
                    <TableRow key={field.label}>
                      <TableCell>{field.label}</TableCell>
                      <TableCell><TraceValueButton value={field.value} onSelect={onSelectTrace} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="time" className="mt-0">
            <div className="overflow-x-auto rounded-[8px] border border-[#E4E7ED]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[#303133]">标题</TableHead>
                    <TableHead className="text-[#303133]">内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {basicInfoView.timeFields.map((field) => (
                    <TableRow key={field.label}>
                      <TableCell>{field.label}</TableCell>
                      <TableCell><TraceValueButton value={field.value} onSelect={onSelectTrace} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="other" className="mt-0">
            <div className="overflow-x-auto rounded-[8px] border border-[#E4E7ED]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[#303133]">标题</TableHead>
                    <TableHead className="text-[#303133]">内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {basicInfoView.otherFields.map((field) => (
                    <TableRow key={field.label}>
                      <TableCell>{field.label}</TableCell>
                      <TableCell><TraceValueButton value={field.value} onSelect={onSelectTrace} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="purchase" className="mt-0">
            <ParsedItemsBlock
              groups={basicInfoView.purchaseGroups}
              emptyText="采购要求暂未识别到明确内容"
              onSelectTrace={onSelectTrace}
            />
          </TabsContent>
        </Tabs>
      </div>
      <SourceTracePanel trace={selectedTrace} />
    </div>
  );
}

function GenericCategoryPanel({
  category,
  definitions,
  emptyLabel,
  selectedTrace,
  onSelectTrace,
}: {
  category?: TenderParsedCategory;
  definitions: readonly TenderSubTabDefinition[];
  emptyLabel: string;
  selectedTrace: TenderSourceTrace | null;
  onSelectTrace: (trace: TenderSourceTrace) => void;
}) {
  const [activeSubTab, setActiveSubTab] = useState(definitions[0]?.key ?? "default");
  const grouped = useMemo(() => pickCategoryGroups(category, [...definitions]), [category, definitions]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col rounded-[8px] border border-[#E4E7ED] bg-white">
        <p className="mb-3 text-xs text-[#909399]">以下内容由 AI 解析生成，仅供参考，请结合右侧原文复核。</p>
        <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="flex-1">
          <TabsList className="mb-3 w-full flex-wrap justify-start rounded-[8px] bg-[#F0F2F5] p-1">
            {definitions.map((definition) => (
              <TabsTrigger
                key={definition.key}
                value={definition.key}
                className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white"
              >
                {definition.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {definitions.map((definition) => (
            <TabsContent key={definition.key} value={definition.key} className="mt-0">
              <ParsedItemsBlock
                groups={grouped[definition.key] ?? []}
                emptyText={getEmptyStateText(definition.label || emptyLabel)}
                onSelectTrace={onSelectTrace}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <SourceTracePanel trace={selectedTrace} />
    </div>
  );
}

function SubmitPanel({
  category,
  selectedTrace,
  onSelectTrace,
}: {
  category?: TenderParsedCategory;
  selectedTrace: TenderSourceTrace | null;
  onSelectTrace: (trace: TenderSourceTrace) => void;
}) {
  const groups = category?.groups ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col rounded-[8px] border border-[#E4E7ED] bg-white">
        <p className="mb-3 text-xs text-[#909399]">以下内容由 AI 解析生成，仅供参考，请结合右侧原文复核。</p>
        <ParsedItemsBlock groups={groups} emptyText="暂未识别到应标需提交文件" onSelectTrace={onSelectTrace} />
      </div>
      <SourceTracePanel trace={selectedTrace} />
    </div>
  );
}

export function ConnectedTenderPage({
  projectName,
  remoteProjectId,
  initialUploadedTender,
  initialCategories = [],
  onAnalysisComplete,
  onAnalysisUiChange,
}: ConnectedTenderPageProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedTender, setUploadedTender] = useState(initialUploadedTender ?? null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStage, setAnalysisStage] = useState("");
  const [progress, setProgress] = useState(0);
  const [lastCompletedTenderKey, setLastCompletedTenderKey] = useState(buildUploadedTenderKey(initialUploadedTender));
  const [categories, setCategories] = useState<TenderParsedCategory[]>(initialCategories);
  const [categoryProgress, setCategoryProgress] = useState<TenderCategoryProgress[]>(
    buildCategoryProgressState(initialCategories),
  );
  const [activeTopTab, setActiveTopTab] = useState<string>("basic");
  const [selectedTrace, setSelectedTrace] = useState<TenderSourceTrace | null>(pickDefaultTrace(initialCategories));
  const loadingTraceIdsRef = useRef(new Set<string>());

  const basicCategory = useMemo(() => findTenderCategory(categories, "basic"), [categories]);
  const qualifyCategory = useMemo(() => findTenderCategory(categories, "qualify"), [categories]);
  const reviewCategory = useMemo(() => findTenderCategory(categories, "review"), [categories]);
  const bidDocCategory = useMemo(() => findTenderCategory(categories, "bidDoc"), [categories]);
  const invalidCategory = useMemo(() => findTenderCategory(categories, "invalid"), [categories]);
  const submitCategory = useMemo(() => findTenderCategory(categories, "submit"), [categories]);
  const clauseCategory = useMemo(() => findTenderCategory(categories, "clause"), [categories]);

  useEffect(() => {
    setCategories(initialCategories);
    setCategoryProgress(buildCategoryProgressState(initialCategories));
    setSelectedTrace(pickDefaultTrace(initialCategories));
  }, [initialCategories]);

  useEffect(() => {
    setUploadedTender(initialUploadedTender ?? null);
    if ((initialCategories?.length ?? 0) > 0) {
      setLastCompletedTenderKey(buildUploadedTenderKey(initialUploadedTender));
    }
  }, [initialUploadedTender, initialCategories]);

  useEffect(() => {
    if (!selectedTrace) {
      const nextTrace = pickDefaultTrace(categories);
      if (nextTrace) {
        setSelectedTrace(nextTrace);
      }
    }
  }, [categories, selectedTrace]);

  useEffect(() => {
    const trace = selectedTrace;
    const sourceItemId = trace?.sourceItemId;
    if (!trace || !sourceItemId || trace.pageNo != null || trace.location !== TENDER_TRACE_PENDING_LOCATION) {
      return;
    }

    if (loadingTraceIdsRef.current.has(sourceItemId)) {
      return;
    }

    let disposed = false;
    loadingTraceIdsRef.current.add(sourceItemId);

    void (async () => {
      try {
        const resolvedTrace = await fetchTenderItemTrace(sourceItemId);
        if (disposed) {
          return;
        }

        setCategories((current) => replaceTraceInCategories(current, sourceItemId, resolvedTrace));
        setSelectedTrace((currentTrace) =>
          currentTrace?.sourceItemId === sourceItemId ? resolvedTrace : currentTrace,
        );
      } catch (error) {
        if (!disposed) {
          toast.error(error instanceof Error ? error.message : "原文定位加载失败");
        }
      } finally {
        loadingTraceIdsRef.current.delete(sourceItemId);
      }
    })();

    return () => {
      disposed = true;
      loadingTraceIdsRef.current.delete(sourceItemId);
    };
  }, [selectedTrace?.location, selectedTrace?.pageNo, selectedTrace?.sourceItemId]);

  const completedCategoryCount = useMemo(
    () => categoryProgress.filter((category) => category.status === "completed").length,
    [categoryProgress],
  );
  const currentRunningCategory = useMemo(
    () => categoryProgress.find((category) => category.status === "running"),
    [categoryProgress],
  );
  const isAnalysisReady = useMemo(() => {
    const currentTenderKey = buildUploadedTenderKey(uploadedTender);
    if (!currentTenderKey || currentTenderKey !== lastCompletedTenderKey || isAnalyzing) {
      return false;
    }
    return categoryProgress.length > 0 && categoryProgress.every((category) => category.status === "completed");
  }, [categoryProgress, isAnalyzing, lastCompletedTenderKey, uploadedTender]);

  useEffect(() => {
    onAnalysisUiChange?.({
      isAnalyzing,
      isReady: isAnalysisReady,
      progress,
      stage: analysisStage,
    });
  }, [analysisStage, isAnalyzing, isAnalysisReady, onAnalysisUiChange, progress]);

  const handleSelectTrace = (trace: TenderSourceTrace) => {
    setSelectedTrace(trace);
  };

  const handleAnalyze = async () => {
    if (!selectedFile) {
      toast.error("请先上传招标文件");
      return;
    }

    setIsAnalyzing(true);
    setProgress(0);
    setAnalysisStage("UPLOAD");
    setCategoryProgress(
      TOP_LEVEL_TABS.map((tab, index) => ({
        key: tab.key,
        label: tab.label,
        status: index === 0 ? "running" : "pending",
        itemCount: 0,
      })),
    );

    try {
      const payload = await runTenderAnalysisWorkflow({
        projectName,
        remoteProjectId,
        file: selectedFile,
        onProgress: (snapshot) => {
          setProgress(snapshot.progress);
          setAnalysisStage(snapshot.stage);

          if (snapshot.categories.length > 0) {
            const visibleCategories = snapshot.categories.filter((category) => category.key !== "other");
            setCategories(visibleCategories);
            setSelectedTrace((currentTrace) => currentTrace ?? pickDefaultTrace(visibleCategories));
          }

          if (snapshot.categoryProgress.length > 0) {
            setCategoryProgress(mergeCategoryProgressState(snapshot.categoryProgress));
          }
        },
      });

      setCategories(payload.categories.filter((category) => category.key !== "other"));
      setCategoryProgress(
        mergeCategoryProgressState(
          payload.categoryProgress.length > 0
            ? payload.categoryProgress
            : buildCategoryProgressState(payload.categories),
        ),
      );
      setUploadedTender(payload.uploadedTender);
      setLastCompletedTenderKey(buildUploadedTenderKey(payload.uploadedTender));
      setSelectedTrace(pickDefaultTrace(payload.categories));
      onAnalysisComplete(payload);
      toast.success("标书解析完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "标书解析失败";
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">智能读标结果</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-[8px] border border-[#E4E7ED] bg-white p-6">
            <h3 className="text-[18px] font-semibold text-[#303133]">上传招标书</h3>
            <p className="mt-6 text-sm text-[#909399]">上传招标文件，系统将自动分析招标要求并生成结构化结果。</p>

            {!selectedFile ? (
              <div className="mt-8 rounded-[8px] border-2 border-dashed border-[#DCE3F0] px-6 py-16 text-center">
                <input
                  id="tender-upload"
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setSelectedFile(nextFile);
                    if (nextFile) {
                      setLastCompletedTenderKey("");
                      setUploadedTender({
                        name: nextFile.name,
                        size: `${(nextFile.size / 1024).toFixed(2)} KB`,
                        format: nextFile.name.split(".").at(-1)?.toUpperCase() ?? "FILE",
                      });
                      setSelectedTrace(null);
                    }
                  }}
                />
                <label htmlFor="tender-upload" className="cursor-pointer">
                  <Upload className="mx-auto h-12 w-12 text-[#909399]" />
                  <p className="mt-4 text-[16px] text-[#303133]">点击选择招标文件</p>
                  <p className="mt-2 text-sm text-[#909399]">支持 PDF, Word, TXT 格式</p>
                </label>
              </div>
            ) : (
              <div className="mt-8 rounded-[8px] border border-[#E4E7ED] bg-[#FAFAFA] p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-[#165DFF]" />
                    <div>
                      <p className="text-sm font-medium text-[#303133]">{selectedFile.name}</p>
                      <p className="text-xs text-[#909399]">
                        {(selectedFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setSelectedFile(null)} disabled={isAnalyzing}>
                      重新选择
                    </Button>
                    <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                      {isAnalyzing ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          解析中
                        </span>
                      ) : (
                        "解析"
                      )}
                    </Button>
                  </div>
                </div>
                {isAnalyzing && (
                  <div className="mt-4 space-y-3">
                    <div className="h-2 rounded-full bg-[#EEF3FF]">
                      <div
                        className="h-2 rounded-full bg-[#165DFF] transition-all"
                        style={{ width: `${Math.max(progress, 8)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#909399]">
                      <span>解析阶段：{analysisStage || "处理中"}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#606266]">
                      <span>已完成 {completedCategoryCount}/{TOP_LEVEL_TABS.length}</span>
                      <span>·</span>
                      <span>{currentRunningCategory ? `当前：${currentRunningCategory.label}` : "等待继续处理"}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Tabs value={activeTopTab} onValueChange={setActiveTopTab} className="w-full">
            <TabsList className="inline-flex h-9 w-full flex-wrap justify-start gap-1 rounded-[8px] bg-[#F0F2F5] p-1">
              {TOP_LEVEL_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  className="rounded-[8px] data-[state=active]:bg-[#165DFF] data-[state=active]:text-white"
                >
                  <span className="mr-1.5">{tab.label}</span>
                  {renderCategoryStatusIndicator(
                    categoryProgress.find((category) => category.key === tab.key)?.status ?? "pending",
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="basic" className="mt-4">
              <BasicInfoPanel
                category={basicCategory}
                selectedTrace={selectedTrace}
                onSelectTrace={handleSelectTrace}
              />
            </TabsContent>

            <TabsContent value="qualify" className="mt-4">
              <SubmitPanel category={qualifyCategory} selectedTrace={selectedTrace} onSelectTrace={handleSelectTrace} />
            </TabsContent>

            <TabsContent value="review" className="mt-4">
              <GenericCategoryPanel
                category={reviewCategory}
                definitions={REVIEW_SUB_TABS}
                emptyLabel="评审要求"
                selectedTrace={selectedTrace}
                onSelectTrace={handleSelectTrace}
              />
            </TabsContent>

            <TabsContent value="bidDoc" className="mt-4">
              <GenericCategoryPanel
                category={bidDocCategory}
                definitions={BID_DOC_SUB_TABS}
                emptyLabel="投标文件要求"
                selectedTrace={selectedTrace}
                onSelectTrace={handleSelectTrace}
              />
            </TabsContent>

            <TabsContent value="invalid" className="mt-4">
              <GenericCategoryPanel
                category={invalidCategory}
                definitions={INVALID_SUB_TABS}
                emptyLabel="无效标与废标项"
                selectedTrace={selectedTrace}
                onSelectTrace={handleSelectTrace}
              />
            </TabsContent>

            <TabsContent value="submit" className="mt-4">
              <SubmitPanel category={submitCategory} selectedTrace={selectedTrace} onSelectTrace={handleSelectTrace} />
            </TabsContent>

            <TabsContent value="clause" className="mt-4">
              <GenericCategoryPanel
                category={clauseCategory}
                definitions={CLAUSE_SUB_TABS}
                emptyLabel="招标文件审查"
                selectedTrace={selectedTrace}
                onSelectTrace={handleSelectTrace}
              />
            </TabsContent>
          </Tabs>

          {uploadedTender && (
            <div className="text-xs text-[#909399]">
              当前文件：{uploadedTender.name} / {uploadedTender.format} / {uploadedTender.size}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
