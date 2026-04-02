import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileDown,
  Files,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ProposalRichEditor, mergeRecommendationIntoHtml } from "./ProposalRichEditor";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import type { TenderRequirement } from "../types/tender";
import type {
  BidKind,
  FlattenedOutlineNode,
  OutlineGroup,
  OutlineNode,
  ProposalRecommendationItem,
  ProposalSectionRecord,
} from "../types/proposal";
import {
  addOutlineChild,
  addOutlineSibling,
  createEmptyOutlineGroup,
  flattenOutlineGroups,
  moveOutlineNode,
  normalizeOutlineGroups,
  removeOutlineNode,
  stripOutlineTitlePrefix,
  updateOutlineNode,
} from "../lib/proposal-outline";
import {
  downloadProposalExport,
  generateProjectOutline,
  generateProposalSection,
  getProjectOutline,
  getProposalRecommendations,
  listProposalSections,
  prepareProposalExport,
  saveProjectOutline,
  saveProposalSectionContent,
  setProposalSectionComplete,
} from "../lib/proposal-workflow";
import { fetchTenderItemTrace, fetchTenderSourceDocument } from "../lib/tender-workflow";

type TenderFileInfo = {
  name: string;
  size: string;
  format: string;
} | null;

type ProjectContextLike = {
  activeProjectId: string;
  projectName: string;
  tenderFile: TenderFileInfo;
  tenderRequirements: TenderRequirement[];
  tenderOutline: string;
  lastParsedAt: string | null;
  proposalCompletedSections: number;
  proposalTotalSections: number;
};

type ProposalWorkspaceProps = {
  projectContext: ProjectContextLike;
  onProjectContextUpdate: (next: Partial<ProjectContextLike>) => void;
};

type SectionDraftState = ProposalSectionRecord & {
  savedContent: string;
  isSaving?: boolean;
};

type OutlineState = Record<BidKind, OutlineGroup[]>;
type ExportState = Partial<Record<BidKind, { filename: string }>>;
type RequirementPreviewMode = "text" | "format";
type SourcePreviewKind = "pdf" | "docx" | "text" | "unsupported";
type LoadedSourcePreview = {
  blob: Blob;
  blobUrl: string;
  fileName: string;
  contentType: string;
  kind: SourcePreviewKind;
  textContent?: string;
};

type SourcePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: LoadedSourcePreview }
  | { status: "error"; message: string };

const sourcePreviewCache = new Map<string, LoadedSourcePreview>();
const PROPOSAL_AUTOSAVE_STORAGE_KEY = "smart-bidding.proposal-autosave-enabled";

function createEmptySectionDraft(sectionKey: string): SectionDraftState {
  return {
    sectionKey,
    content: "",
    savedContent: "",
    completed: false,
    version: 0,
  };
}

function ensureOutlineState(source?: Partial<OutlineState>) {
  const emptyTechGroup = createEmptyOutlineGroup("技术标");
  const emptyBizGroup = createEmptyOutlineGroup("商务标");
  return {
    tech: source?.tech ?? [{ ...emptyTechGroup, sections: [] }],
    biz: source?.biz ?? [{ ...emptyBizGroup, sections: [] }],
  } satisfies OutlineState;
}

function mergeSectionsWithOutline(
  outlineState: OutlineState,
  loadedSections: ProposalSectionRecord[],
  existing?: Record<string, SectionDraftState>,
) {
  const result: Record<string, SectionDraftState> = {};

  Object.values(existing ?? {}).forEach((entry) => {
    result[entry.sectionKey] = entry;
  });

  loadedSections.forEach((entry) => {
    result[entry.sectionKey] = {
      ...createEmptySectionDraft(entry.sectionKey),
      ...entry,
      savedContent: entry.content,
    };
  });

  const allIds = [
    ...flattenOutlineGroups(outlineState.tech).map((item) => item.id),
    ...flattenOutlineGroups(outlineState.biz).map((item) => item.id),
  ];

  allIds.forEach((sectionKey) => {
    if (!result[sectionKey]) {
      result[sectionKey] = createEmptySectionDraft(sectionKey);
    }
  });

  return result;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToHtml(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line || " ")}</p>`)
    .join("");
}

function htmlToPlainText(html: string) {
  const element = window.document.createElement("div");
  element.innerHTML = html;
  return element.textContent?.replace(/\s+/g, " ").trim() || "";
}

function countHtmlCharacters(html: string) {
  return htmlToPlainText(html).replace(/\s+/g, "").length;
}

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

function scoreTextMatch(keyword: string, title: string, description: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedDescription = description.trim().toLowerCase();

  if (!normalizedKeyword) {
    return 0;
  }

  let score = 0;
  if (normalizedTitle.includes(normalizedKeyword)) {
    score += 5;
  }
  if (normalizedDescription.includes(normalizedKeyword)) {
    score += 3;
  }
  return score;
}

function pickRelevantRequirements(requirements: TenderRequirement[], section: FlattenedOutlineNode | null) {
  if (!section) {
    return [];
  }

  const keywords = Array.from(new Set([section.title, ...section.pathTitles].map((item) => item.trim()).filter(Boolean)));

  return [...requirements]
    .map((item) => ({
      item,
      score: keywords.reduce(
        (total, keyword) => total + scoreTextMatch(keyword, item.title, item.description),
        0,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((entry) => entry.item);
}

function pickRequirementsBySourceIds(requirements: TenderRequirement[], sourceItemIds?: string[]) {
  if (!sourceItemIds || sourceItemIds.length === 0) {
    return [];
  }

  const order = new Map(sourceItemIds.map((id, index) => [id, index]));
  return [...requirements]
    .filter((item) => order.has(item.id))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

function formatRequirementList(requirements: TenderRequirement[]) {
  return requirements
    .map((item) => {
      const title = item.title.trim();
      const description = item.description.trim();
      return title ? `${title}\n${description}`.trim() : description;
    })
    .filter(Boolean)
    .join("\n\n");
}

function getOutlineDisplayTitle(title: string) {
  return stripOutlineTitlePrefix(title);
}

function buildOutlineBindingLookup(groups: OutlineGroup[]) {
  const bySourceIds = new Map<string, string>();
  const byTitle = new Map<string, string>();

  const walk = (nodes: OutlineNode[]) => {
    nodes.forEach((node) => {
      const text = node.boundRequirementText?.trim();
      if (text) {
        const sourceKey = (node.sourceItemIds ?? []).filter(Boolean).sort().join("|");
        if (sourceKey && !bySourceIds.has(sourceKey)) {
          bySourceIds.set(sourceKey, text);
        }
        const titleKey = getOutlineDisplayTitle(node.title);
        if (titleKey && !byTitle.has(titleKey)) {
          byTitle.set(titleKey, text);
        }
      }
      walk(node.children);
    });
  };

  groups.forEach((group) => walk(group.sections));
  return { bySourceIds, byTitle };
}

function mergeOutlineBoundRequirementText(nextGroups: OutlineGroup[], currentGroups: OutlineGroup[]) {
  const lookup = buildOutlineBindingLookup(currentGroups);
  const applyNode = (node: OutlineNode): OutlineNode => {
    const sourceKey = (node.sourceItemIds ?? []).filter(Boolean).sort().join("|");
    const inheritedText =
      node.boundRequirementText?.trim() ||
      (sourceKey ? lookup.bySourceIds.get(sourceKey) : undefined) ||
      lookup.byTitle.get(getOutlineDisplayTitle(node.title));

    return {
      ...node,
      boundRequirementText: inheritedText,
      children: node.children.map((child) => applyNode(child)),
    };
  };

  return nextGroups.map((group) => ({
    ...group,
    sections: group.sections.map((node) => applyNode(node)),
  }));
}

function summarizeOutlineGroups(groups: OutlineGroup[]) {
  const flat = flattenOutlineGroups(groups);
  const preferred = flat.filter((item) => item.level === 1);
  const source = preferred.length > 0 ? preferred : flat;

  if (source.length === 0) {
    return "待生成";
  }

  return source.map((item) => `${item.numbering} ${getOutlineDisplayTitle(item.title)}`).join(" ");
}

function OutlineNavigatorNode({
  node,
  activeSectionKey,
  completedKeys,
  onSelect,
  depth,
}: {
  node: FlattenedOutlineNode;
  activeSectionKey: string | null;
  completedKeys: Set<string>;
  onSelect: (sectionKey: string) => void;
  depth: number;
}) {
  const active = activeSectionKey === node.id;

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={`flex w-full items-start justify-between rounded-[8px] px-3 py-2 text-left text-sm transition ${
        active ? "bg-[#EEF4FF] text-[#165DFF]" : "hover:bg-[#F5F7FA] text-[#303133]"
      }`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      <span className="leading-6">
        <span className="mr-1 font-medium">{node.numbering}</span>
        {getOutlineDisplayTitle(node.title)}
      </span>
      {completedKeys.has(node.id) ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /> : null}
    </button>
  );
}

function buildOutlineTreeRows(groups: OutlineGroup[]) {
  const rows: Array<{ section: FlattenedOutlineNode; depth: number }> = [];
  const flat = flattenOutlineGroups(groups);
  flat.forEach((item) => {
    rows.push({
      section: item,
      depth: Math.max(0, item.level - 1),
    });
  });
  return rows;
}

function OutlineEditorNode({
  node,
  level,
  onTitleChange,
  onDetailChange,
  onAddSibling,
  onAddChild,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  node: OutlineNode;
  level: number;
  onTitleChange: (nodeId: string, title: string) => void;
  onDetailChange: (nodeId: string, detail: string) => void;
  onAddSibling: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onMoveUp: (nodeId: string) => void;
  onMoveDown: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-[10px] border border-[#E4E7ED] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">L{level}</Badge>
        <Input
          value={node.title}
          onChange={(event) => onTitleChange(node.id, event.target.value)}
          className="max-w-[320px]"
          placeholder="请输入标题"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => onMoveUp(node.id)}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onMoveDown(node.id)}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onAddSibling(node.id)}>
          <Plus className="mr-1 h-4 w-4" />
          同级
        </Button>
        {level < 5 ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onAddChild(node.id)}>
            <Plus className="mr-1 h-4 w-4" />
            子级
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" className="text-red-600" onClick={() => onRemove(node.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        value={node.detail || ""}
        onChange={(event) => onDetailChange(node.id, event.target.value)}
        className="min-h-[72px]"
        placeholder="填写该标题下应写的内容要点"
      />
      {node.children.length > 0 ? (
        <div className="space-y-2 border-l-2 border-[#EEF2F7] pl-4">
          {node.children.map((child) => (
            <OutlineEditorNode
              key={child.id}
              node={child}
              level={level + 1}
              onTitleChange={onTitleChange}
              onDetailChange={onDetailChange}
              onAddSibling={onAddSibling}
              onAddChild={onAddChild}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProposalWorkspace({ projectContext, onProjectContextUpdate }: ProposalWorkspaceProps) {
  const projectId = projectContext.activeProjectId;
  const canUseProposal = Boolean(projectId && projectId !== "proj-default" && projectContext.lastParsedAt);
  const [activeKind, setActiveKind] = useState<BidKind>("tech");
  const [outlineState, setOutlineState] = useState<OutlineState>(ensureOutlineState());
  const [outlineDraft, setOutlineDraft] = useState<OutlineState>(ensureOutlineState());
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, SectionDraftState>>({});
  const [selectedSectionByKind, setSelectedSectionByKind] = useState<Record<BidKind, string | null>>({
    tech: null,
    biz: null,
  });
  const [outlineEditorOpen, setOutlineEditorOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isSavingOutline, setIsSavingOutline] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isPreparingExport, setIsPreparingExport] = useState(false);
  const [recommendations, setRecommendations] = useState<ProposalRecommendationItem[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [preparedExports, setPreparedExports] = useState<ExportState>({});
  const [requirementPreviewMode, setRequirementPreviewMode] = useState<RequirementPreviewMode>("text");
  const [sourcePreviewState, setSourcePreviewState] = useState<SourcePreviewState>({ status: "idle" });
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [isEditingBoundRequirement, setIsEditingBoundRequirement] = useState(false);
  const [boundRequirementDraft, setBoundRequirementDraft] = useState("");
  const [isSavingBoundRequirement, setIsSavingBoundRequirement] = useState(false);
  const [optimizeDialogOpen, setOptimizeDialogOpen] = useState(false);
  const [optimizePrompt, setOptimizePrompt] = useState("");
  const currentSectionRef = useRef<string | null>(null);
  const docxPreviewRef = useRef<HTMLDivElement | null>(null);

  const flatSections = useMemo(
    () => ({
      tech: flattenOutlineGroups(outlineState.tech),
      biz: flattenOutlineGroups(outlineState.biz),
    }),
    [outlineState],
  );

  const treeRows = useMemo(
    () => ({
      tech: buildOutlineTreeRows(outlineState.tech),
      biz: buildOutlineTreeRows(outlineState.biz),
    }),
    [outlineState],
  );

  const currentSectionKey = selectedSectionByKind[activeKind];
  const currentSection = flatSections[activeKind].find((item) => item.id === currentSectionKey) ?? null;
  const currentSectionDraft = currentSectionKey ? sectionDrafts[currentSectionKey] ?? createEmptySectionDraft(currentSectionKey) : null;
  const currentSectionRequirements = useMemo(
    () => {
      const boundRequirements = pickRequirementsBySourceIds(projectContext.tenderRequirements, currentSection?.sourceItemIds);
      return boundRequirements.length > 0
        ? boundRequirements
        : pickRelevantRequirements(projectContext.tenderRequirements, currentSection);
    },
    [currentSection, projectContext.tenderRequirements],
  );
  const currentSectionRequirementText = useMemo(
    () => formatRequirementList(currentSectionRequirements),
    [currentSectionRequirements],
  );
  const currentBoundRequirementText = useMemo(
    () => currentSection?.boundRequirementText?.trim() || currentSectionRequirementText,
    [currentSection?.boundRequirementText, currentSectionRequirementText],
  );
  const effectiveBoundRequirementText = useMemo(
    () => (isEditingBoundRequirement ? boundRequirementDraft.trim() || currentBoundRequirementText : currentBoundRequirementText),
    [boundRequirementDraft, currentBoundRequirementText, isEditingBoundRequirement],
  );
  const hasManualBoundRequirementText = Boolean(currentSection?.boundRequirementText?.trim());
  const currentSectionWordCount = useMemo(
    () => countHtmlCharacters(currentSectionDraft?.content || ""),
    [currentSectionDraft?.content],
  );
  const previewRequirementId =
    currentSectionRequirements[0]?.id ?? currentSection?.sourceItemIds?.[0] ?? projectContext.tenderRequirements[0]?.id ?? null;
  const techOutlineSummary = useMemo(() => summarizeOutlineGroups(outlineState.tech), [outlineState.tech]);
  const bizOutlineSummary = useMemo(() => summarizeOutlineGroups(outlineState.biz), [outlineState.biz]);
  const completedKeySet = useMemo(
    () =>
      new Set(
        Object.values(sectionDrafts)
          .filter((item) => item.completed)
          .map((item) => item.sectionKey),
      ),
    [sectionDrafts],
  );

  useEffect(() => {
    currentSectionRef.current = currentSectionKey;
  }, [currentSectionKey]);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(PROPOSAL_AUTOSAVE_STORAGE_KEY);
    setAutoSaveEnabled(storedValue === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PROPOSAL_AUTOSAVE_STORAGE_KEY, autoSaveEnabled ? "true" : "false");
  }, [autoSaveEnabled]);

  useEffect(() => {
    setRequirementPreviewMode("text");
    setSourcePreviewState({ status: "idle" });
    setIsEditingBoundRequirement(false);
    setBoundRequirementDraft(currentSection?.boundRequirementText?.trim() || currentSectionRequirementText);
    setOptimizeDialogOpen(false);
    setOptimizePrompt("");
  }, [currentSection?.boundRequirementText, currentSectionKey, currentSectionRequirementText]);

  useEffect(() => {
    if (!canUseProposal) {
      setOutlineState(ensureOutlineState());
      setOutlineDraft(ensureOutlineState());
      setSectionDrafts({});
      setPreparedExports({});
      return;
    }

    let disposed = false;
    setIsLoading(true);

    void (async () => {
      try {
        const [outlineResponse, sectionResponse] = await Promise.all([
          getProjectOutline(projectId),
          listProposalSections(projectId),
        ]);

        if (disposed) {
          return;
        }

        const nextOutlineState = ensureOutlineState({
          tech: normalizeOutlineGroups(outlineResponse.techOutlineSections, "技术标"),
          biz: normalizeOutlineGroups(outlineResponse.bizOutlineSections, "商务标"),
        });

        setOutlineState(nextOutlineState);
        setOutlineDraft(nextOutlineState);
        setSectionDrafts((current) => mergeSectionsWithOutline(nextOutlineState, sectionResponse.list, current));
      } catch (error) {
        if (!disposed) {
          toast.error(error instanceof Error ? error.message : "加载标书编制数据失败");
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [canUseProposal, projectId]);

  useEffect(() => {
    setSectionDrafts((current) => mergeSectionsWithOutline(outlineState, [], current));
  }, [outlineState]);

  useEffect(() => {
    const ids = flatSections[activeKind].map((item) => item.id);
    if (ids.length === 0) {
      return;
    }

    const selected = selectedSectionByKind[activeKind];
    if (!selected || !ids.includes(selected)) {
      setSelectedSectionByKind((current) => ({
        ...current,
        [activeKind]: ids[0],
      }));
    }
  }, [activeKind, flatSections, selectedSectionByKind]);

  useEffect(() => {
    const totalSections = flatSections.tech.length + flatSections.biz.length;
    const completedSections = Object.values(sectionDrafts).filter((item) => item.completed).length;
    onProjectContextUpdate({
      proposalCompletedSections: completedSections,
      proposalTotalSections: totalSections,
    });
  }, [flatSections.biz.length, flatSections.tech.length, onProjectContextUpdate, sectionDrafts]);

  useEffect(() => {
    if (!projectId || !currentSection) {
      setRecommendations([]);
      setSelectedAssetIds([]);
      return;
    }

    let disposed = false;
    setLoadingRecommendations(true);
    setSelectedAssetIds([]);

    void (async () => {
      try {
        const result = await getProposalRecommendations(projectId, currentSection.id, currentSection.title);
        if (!disposed) {
          setRecommendations(result.list);
        }
      } catch (error) {
        if (!disposed) {
          toast.error(error instanceof Error ? error.message : "加载历史素材失败");
        }
      } finally {
        if (!disposed) {
          setLoadingRecommendations(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [currentSection, projectId]);

  useEffect(() => {
    if (requirementPreviewMode !== "format") {
      return;
    }

    if (!previewRequirementId) {
      setSourcePreviewState({ status: "error", message: "当前章节暂无可预览的招标原文" });
      return;
    }

    let disposed = false;
    setSourcePreviewState({ status: "loading" });

    void (async () => {
      try {
        const trace = await fetchTenderItemTrace(previewRequirementId);
        const documentVersionId = trace.documentVersionId;

        if (!documentVersionId) {
          throw new Error("当前招标文件暂不支持原文格式预览");
        }

        const cachedPreview = sourcePreviewCache.get(documentVersionId);
        if (cachedPreview) {
          if (!disposed) {
            setSourcePreviewState({ status: "ready", preview: cachedPreview });
          }
          return;
        }

        const response = await fetchTenderSourceDocument(documentVersionId);
        const blob = await response.blob();
        const fileName = parseResponseFileName(response);
        const contentType = response.headers.get("content-type") || blob.type || "application/octet-stream";
        const kind = resolvePreviewKind(contentType, fileName);
        const preview: LoadedSourcePreview = {
          blob,
          blobUrl: URL.createObjectURL(blob),
          fileName,
          contentType,
          kind,
          textContent: kind === "text" ? await blob.text() : undefined,
        };

        sourcePreviewCache.set(documentVersionId, preview);
        if (!disposed) {
          setSourcePreviewState({ status: "ready", preview });
        }
      } catch (error) {
        if (!disposed) {
          setSourcePreviewState({
            status: "error",
            message: error instanceof Error ? error.message : "招标原文加载失败",
          });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [previewRequirementId, requirementPreviewMode]);

  useEffect(() => {
    if (sourcePreviewState.status !== "ready" || sourcePreviewState.preview.kind !== "docx" || !docxPreviewRef.current) {
      return;
    }

    let disposed = false;
    const container = docxPreviewRef.current;
    container.innerHTML = "";

    void (async () => {
      const { renderAsync } = await import("docx-preview");
      if (disposed) {
        return;
      }

      await renderAsync(sourcePreviewState.preview.blob, container, undefined, {
        inWrapper: true,
        breakPages: true,
        ignoreWidth: false,
        ignoreHeight: false,
      });
    })();

    return () => {
      disposed = true;
      container.innerHTML = "";
    };
  }, [sourcePreviewState]);

  useEffect(() => {
    if (!autoSaveEnabled || !projectId || !currentSectionKey) {
      return;
    }

    const entry = sectionDrafts[currentSectionKey];
    if (!entry || entry.content === entry.savedContent) {
      return;
    }

    const timer = window.setTimeout(() => {
      void persistSectionContent(currentSectionKey);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, currentSectionKey, projectId, sectionDrafts]);

  async function persistSectionContent(sectionKey: string) {
    const draft = sectionDrafts[sectionKey];
    if (!projectId || !draft || draft.content === draft.savedContent || draft.isSaving) {
      return;
    }

    setSectionDrafts((current) => ({
      ...current,
      [sectionKey]: {
        ...current[sectionKey],
        isSaving: true,
      },
    }));

    try {
      const result = await saveProposalSectionContent(projectId, sectionKey, draft.content);
      setSectionDrafts((current) => ({
        ...current,
        [sectionKey]: {
          ...current[sectionKey],
          isSaving: false,
          savedContent: current[sectionKey].content,
          version: result.version,
        },
      }));
    } catch (error) {
      setSectionDrafts((current) => ({
        ...current,
        [sectionKey]: {
          ...current[sectionKey],
          isSaving: false,
        },
      }));
      throw error;
    }
  }

  async function saveDirtySections() {
    const dirtyKeys = Object.values(sectionDrafts)
      .filter((entry) => entry.content !== entry.savedContent)
      .map((entry) => entry.sectionKey);

    for (const key of dirtyKeys) {
      await persistSectionContent(key);
    }
  }

  async function handleSelectSection(sectionKey: string) {
    const currentKey = currentSectionRef.current;
    if (currentKey && sectionDrafts[currentKey] && sectionDrafts[currentKey].content !== sectionDrafts[currentKey].savedContent) {
      try {
        await persistSectionContent(currentKey);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "章节内容保存失败");
      }
    }

    setSelectedSectionByKind((current) => ({
      ...current,
      [activeKind]: sectionKey,
    }));
  }

  function updateCurrentSectionContent(nextContent: string) {
    if (!currentSectionKey) {
      return;
    }

    setSectionDrafts((current) => ({
      ...current,
      [currentSectionKey]: {
        ...(current[currentSectionKey] ?? createEmptySectionDraft(currentSectionKey)),
        content: nextContent,
      },
    }));
  }

  async function handleGenerateOutline() {
    if (!canUseProposal) {
      toast.error("请先完成招标文件解析");
      return;
    }

    setIsGeneratingOutline(true);
    try {
      const response = await generateProjectOutline(projectId);
      const generatedDraft = ensureOutlineState({
        tech: normalizeOutlineGroups(response.techOutlineSections, "技术标"),
        biz: normalizeOutlineGroups(response.bizOutlineSections, "商务标"),
      });
      const nextDraft = {
        tech: mergeOutlineBoundRequirementText(generatedDraft.tech, outlineState.tech),
        biz: mergeOutlineBoundRequirementText(generatedDraft.biz, outlineState.biz),
      } satisfies OutlineState;
      setOutlineDraft(nextDraft);
      setOutlineEditorOpen(true);
      toast.success("大纲已生成，请调整并保存结构");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "大纲生成失败");
    } finally {
      setIsGeneratingOutline(false);
    }
  }

  async function handleSaveOutline() {
    if (!canUseProposal) {
      return;
    }

    setIsSavingOutline(true);
    try {
      await saveProjectOutline(projectId, {
        tenderOutline: projectContext.tenderOutline,
        techOutlineSections: outlineDraft.tech,
        bizOutlineSections: outlineDraft.biz,
      });
      setOutlineState(outlineDraft);
      setOutlineEditorOpen(false);
      setPreparedExports({});
      toast.success("大纲已确认，章节导航已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存大纲失败");
    } finally {
      setIsSavingOutline(false);
    }
  }

  function updateDraftGroups(kind: BidKind, groups: OutlineGroup[]) {
    setOutlineDraft((current) => ({
      ...current,
      [kind]: groups,
    }));
  }

  function updateDraftNodeTitle(kind: BidKind, nodeId: string, title: string) {
    updateDraftGroups(
      kind,
      updateOutlineNode(outlineDraft[kind], nodeId, (node) => ({
        ...node,
        title,
      })),
    );
  }

  function updateDraftNodeDetail(kind: BidKind, nodeId: string, detail: string) {
    updateDraftGroups(
      kind,
      updateOutlineNode(outlineDraft[kind], nodeId, (node) => ({
        ...node,
        detail,
      })),
    );
  }

  function updateNodeBoundRequirementText(groups: OutlineGroup[], nodeId: string, boundRequirementText?: string) {
    const nextText = boundRequirementText?.trim();
    return updateOutlineNode(groups, nodeId, (node) => ({
      ...node,
      boundRequirementText: nextText || undefined,
    }));
  }

  async function handleSaveBoundRequirementText() {
    if (!projectId || !currentSection) {
      return;
    }

    const trimmed = boundRequirementDraft.trim();
    const nextOutlineState: OutlineState = {
      ...outlineState,
      [activeKind]: updateNodeBoundRequirementText(outlineState[activeKind], currentSection.id, trimmed),
    };

    setIsSavingBoundRequirement(true);
    try {
      await saveProjectOutline(projectId, {
        tenderOutline: projectContext.tenderOutline,
        techOutlineSections: nextOutlineState.tech,
        bizOutlineSections: nextOutlineState.biz,
      });
      setOutlineState(nextOutlineState);
      setOutlineDraft((current) => ({
        tech:
          activeKind === "tech"
            ? updateNodeBoundRequirementText(current.tech, currentSection.id, trimmed)
            : current.tech,
        biz:
          activeKind === "biz"
            ? updateNodeBoundRequirementText(current.biz, currentSection.id, trimmed)
            : current.biz,
      }));
      setIsEditingBoundRequirement(false);
      setBoundRequirementDraft(trimmed);
      toast.success(trimmed ? "原文绑定文本已保存" : "已清空手动维护的原文绑定文本");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存原文绑定文本失败");
    } finally {
      setIsSavingBoundRequirement(false);
    }
  }

  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  }

  function handleReuseSelectedAssets() {
    if (!currentSectionKey) {
      return;
    }

    const matched = recommendations.filter((item) => selectedAssetIds.includes(item.id));
    if (matched.length === 0) {
      toast.error("请先选择要复用的历史内容");
      return;
    }

    const mergedHtml = matched.reduce((html, item) => {
      const nextContent = item.content || item.snippet || "";
      if (!nextContent) {
        return html;
      }
      return mergeRecommendationIntoHtml(html, nextContent.includes("<") ? nextContent : plainTextToHtml(nextContent));
    }, currentSectionDraft?.content || "");

    updateCurrentSectionContent(mergedHtml);
    toast.success("已复用所选历史内容");
  }

  function openOptimizeDialog() {
    if (!currentSection) {
      return;
    }

    setOptimizeDialogOpen(true);
  }

  async function handleOptimizeSection() {
    if (!projectId || !currentSectionKey || !currentSection) {
      return;
    }

    const currentContent = currentSectionDraft?.content || "";
    const plainText = htmlToPlainText(currentContent);

    setIsOptimizing(true);
    try {
      const result = await generateProposalSection(projectId, currentSectionKey, {
        bidKind: activeKind,
        sectionTitle: getOutlineDisplayTitle(currentSection.title),
        sectionDetail: currentSection.detail,
        outlinePath: currentSection.sectionPath,
        currentContent: undefined,
        assetIds: undefined,
        sourceItemIds: currentSection.sourceItemIds,
        boundRequirementText: effectiveBoundRequirementText || undefined,
        customPrompt: optimizePrompt.trim() || undefined,
        context: undefined,
      });

      updateCurrentSectionContent(result.content || currentContent);
      setOptimizeDialogOpen(false);
      setOptimizePrompt("");
      toast.success(plainText ? "章节内容已优化" : "章节内容已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "章节生成失败");
    } finally {
      setIsOptimizing(false);
    }
  }

  async function handleToggleComplete() {
    if (!projectId || !currentSectionKey || !currentSectionDraft) {
      return;
    }

    try {
      await saveDirtySections();
      const completed = !currentSectionDraft.completed;
      await setProposalSectionComplete(projectId, currentSectionKey, completed);
      setSectionDrafts((current) => ({
        ...current,
        [currentSectionKey]: {
          ...current[currentSectionKey],
          completed,
        },
      }));
      toast.success(completed ? "章节已标记完成" : "章节已取消完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "章节状态更新失败");
    }
  }

  async function handlePrepareExport() {
    if (!projectId) {
      return;
    }

    setIsPreparingExport(true);
    try {
      await saveDirtySections();
      const result = await prepareProposalExport(projectId, activeKind);
      setPreparedExports((current) => ({
        ...current,
        [activeKind]: {
          filename: result.filename,
        },
      }));
      toast.success(`${activeKind === "tech" ? "技术标" : "商务标"}已完成排版，可下载`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "排版失败");
    } finally {
      setIsPreparingExport(false);
    }
  }

  async function handleDownload(kind: BidKind) {
    const exportMeta = preparedExports[kind];
    if (!projectId || !exportMeta) {
      return;
    }

    try {
      await downloadProposalExport(projectId, kind, exportMeta.filename);
      toast.success("下载已开始");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    }
  }

  if (!canUseProposal) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-[#606266]">
          请先在“招标处理”页完成招标文件解析，然后再进入标书编制。
        </CardContent>
      </Card>
    );
  }

  const currentRows = treeRows[activeKind];
  const activeCompletedCount = flatSections[activeKind].filter((item) => completedKeySet.has(item.id)).length;
  const activeTotalCount = flatSections[activeKind].length;
  const hasGeneratedOutline = flatSections.tech.length + flatSections.biz.length > 0;
  const preparedExport = preparedExports[activeKind];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">标书编制工作台</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="rounded-[10px] border border-[#E4E7ED] bg-[#F8FAFC] p-4">
              <p className="text-sm font-medium text-[#303133]">已自动读取上一步解析结果</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#606266]">
                <Badge variant="outline">项目：{projectContext.projectName}</Badge>
                <Badge variant="outline">招标要求：{projectContext.tenderRequirements.length} 条</Badge>
                <Badge variant="outline">文件：{projectContext.tenderFile?.name || "未读取到文件名"}</Badge>
                <Badge variant="outline">解析时间：{projectContext.lastParsedAt || "未知"}</Badge>
              </div>
              <div className="mt-3 rounded-[8px] border border-dashed border-[#D6E4FF] bg-white p-3 text-sm leading-6 text-[#606266]">
                <div>
                  <span className="font-medium text-[#303133]">技术标大纲：</span>
                  <span>{techOutlineSummary}</span>
                </div>
                <div className="mt-2">
                  <span className="font-medium text-[#303133]">商务标大纲：</span>
                  <span>{bizOutlineSummary}</span>
                </div>
              </div>
            </div>
            <div className="rounded-[10px] border border-[#E4E7ED] bg-white p-4">
              <p className="text-sm font-medium text-[#303133]">大纲生成</p>
              <p className="mt-2 text-xs leading-6 text-[#606266]">
                点击生成后，系统会基于招标文件结构要求分别生成技术标和商务标大纲。你确认并修改后，章节导航会按最终大纲同步刷新。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={handleGenerateOutline} disabled={isGeneratingOutline || isLoading}>
                  {isGeneratingOutline ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {hasGeneratedOutline ? "重新生成大纲" : "生成投标大纲"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOutlineDraft(outlineState);
                    setOutlineEditorOpen(true);
                  }}
                  disabled={!hasGeneratedOutline}
                >
                  编辑当前大纲
                </Button>
              </div>
            </div>
          </div>

          <Tabs value={activeKind} onValueChange={(value) => setActiveKind(value as BidKind)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="tech">技术标</TabsTrigger>
              <TabsTrigger value="biz">商务标</TabsTrigger>
            </TabsList>
            {(["tech", "biz"] as const).map((kind) => (
              <TabsContent key={kind} value={kind} className="mt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      当前进度 {kind === activeKind ? activeCompletedCount : flatSections[kind].filter((item) => completedKeySet.has(item.id)).length}/
                      {kind === activeKind ? activeTotalCount : flatSections[kind].length}
                    </Badge>
                    <Badge variant="outline">当前页签：{kind === "tech" ? "技术标" : "商务标"}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setOutlineEditorOpen(true)}>
                      <Files className="mr-1 h-4 w-4" />
                      调整结构
                    </Button>
                    <Button size="sm" variant="outline" onClick={openOptimizeDialog} disabled={!currentSection || isOptimizing}>
                      {isOptimizing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                      优化标书
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleToggleComplete} disabled={!currentSection}>
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                      {currentSectionDraft?.completed ? "取消完成" : "标记章节完成"}
                    </Button>
                    <Button size="sm" onClick={handlePrepareExport} disabled={isPreparingExport || activeTotalCount === 0}>
                      {isPreparingExport ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                      保存并排版
                    </Button>
                    {preparedExport ? (
                      <Button size="sm" variant="outline" onClick={() => void handleDownload(activeKind)}>
                        <FileDown className="mr-1 h-4 w-4" />
                        下载
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">章节导航</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      {isLoading ? (
                        <div className="flex h-[580px] items-center justify-center text-sm text-[#909399]">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          正在读取大纲...
                        </div>
                      ) : currentRows.length === 0 ? (
                        <div className="px-4 py-12 text-center text-sm text-[#909399]">请先生成大纲</div>
                      ) : (
                        <ScrollArea className="h-[580px] px-3 py-3">
                          <div className="space-y-1">
                            {currentRows.map((row) => (
                              <OutlineNavigatorNode
                                key={row.section.id}
                                node={row.section}
                                depth={row.depth}
                                activeSectionKey={currentSectionKey}
                                completedKeys={completedKeySet}
                                onSelect={(sectionKey) => {
                                  void handleSelectSection(sectionKey);
                                }}
                              />
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="gap-3">
                    <CardHeader className="pb-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-sm">正文编辑</CardTitle>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#909399]">
                          <Badge variant="outline" className="border-[#D6E4FF] bg-[#F7FAFF] text-[#165DFF]">
                            本页字数 {currentSectionWordCount.toLocaleString("zh-CN")}
                          </Badge>
                          <label className="inline-flex items-center gap-2 text-xs text-[#606266]">
                            <Switch
                              checked={autoSaveEnabled}
                              onCheckedChange={setAutoSaveEnabled}
                              aria-label="切换自动保存"
                            />
                            <span>{autoSaveEnabled ? "自动保存已开启" : "自动保存已关闭"}</span>
                          </label>
                          {autoSaveEnabled && currentSectionDraft?.isSaving ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              保存中
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-0">
                      {currentSection ? (
                        <>
                          <div className="rounded-[8px] border border-[#E4E7ED] bg-[#F8FAFC] p-3 text-sm text-[#303133]">
                            <p className="font-medium">
                              {currentSection.numbering} {getOutlineDisplayTitle(currentSection.title)}
                            </p>
                            <p className="mt-1 text-xs text-[#606266]">{currentSection.sectionPath}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {currentSection.sourceItemIds?.length ? (
                                <Badge variant="outline" className="border-[#D6E4FF] bg-[#F7FAFF] text-[#165DFF]">
                                  已绑定原文 {currentSection.sourceItemIds.length} 条
                                </Badge>
                              ) : null}
                              {currentSection.sourceType ? (
                                <Badge variant="outline">
                                  {currentSection.sourceType === "tender"
                                    ? "来源: 原文"
                                    : currentSection.sourceType === "reference"
                                      ? "来源: 参考补盲"
                                      : "来源: AI归纳"}
                                </Badge>
                              ) : null}
                              {hasManualBoundRequirementText ? (
                                <Badge variant="outline" className="border-[#E8D9B5] bg-[#FFF8E8] text-[#9A6700]">
                                  已手动维护原文绑定文本
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-3 rounded-[8px] border border-[#E4E7ED] bg-white">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2F7] px-3 py-2">
                                <p className="text-xs font-medium text-[#303133]">招标原要求</p>
                                <span className="text-[11px] text-[#909399]">长内容支持滚动查看</span>
                              </div>
                              <Tabs value={requirementPreviewMode} onValueChange={(value) => setRequirementPreviewMode(value as RequirementPreviewMode)}>
                                <div className="px-3 pt-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <TabsList className="grid w-fit grid-cols-2">
                                      <TabsTrigger value="text">{currentSection.sourceItemIds?.length ? "原文绑定文本" : "匹配文本"}</TabsTrigger>
                                      <TabsTrigger value="format" disabled={!previewRequirementId}>
                                        原文格式
                                      </TabsTrigger>
                                    </TabsList>
                                    {requirementPreviewMode === "text" ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        {isEditingBoundRequirement ? (
                                          <>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              onClick={() => {
                                                setIsEditingBoundRequirement(false);
                                                setBoundRequirementDraft(currentBoundRequirementText);
                                              }}
                                              disabled={isSavingBoundRequirement}
                                            >
                                              取消
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              onClick={() => void handleSaveBoundRequirementText()}
                                              disabled={isSavingBoundRequirement}
                                            >
                                              {isSavingBoundRequirement ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                                              保存
                                            </Button>
                                          </>
                                        ) : (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setBoundRequirementDraft(currentBoundRequirementText);
                                              setIsEditingBoundRequirement(true);
                                            }}
                                          >
                                            修改
                                          </Button>
                                        )}
                                      </div>
                                    ) : null}
                                    {sourcePreviewState.status === "ready" ? (
                                      <a
                                        href={sourcePreviewState.preview.blobUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        download={sourcePreviewState.preview.fileName}
                                        className="text-[11px] text-[#165DFF] transition hover:text-[#0E4FCC]"
                                      >
                                        打开原文件
                                      </a>
                                    ) : null}
                                  </div>
                                </div>

                                <TabsContent value="text" className="mt-0 px-3 pb-3 pt-3">
                                  {isEditingBoundRequirement ? (
                                    <Textarea
                                      value={boundRequirementDraft}
                                      onChange={(event) => setBoundRequirementDraft(event.target.value)}
                                      className="min-h-[220px] text-xs leading-6"
                                      placeholder="可直接粘贴当前章节对应的招标原文，保存后将优先用于本章节生成。"
                                    />
                                  ) : (
                                    <ScrollArea className="h-[220px] pr-3">
                                      {currentBoundRequirementText ? (
                                        <p className="whitespace-pre-wrap break-words text-xs leading-6 text-[#606266]">
                                          {currentBoundRequirementText}
                                        </p>
                                      ) : null}
                                    {!currentBoundRequirementText && currentSectionRequirements.length > 0 ? (
                                      <div className="space-y-3">
                                        {currentSectionRequirements.map((requirement) => (
                                          <div key={requirement.id} className="space-y-1">
                                            <p className="text-xs font-medium text-[#303133]">{requirement.title}</p>
                                            <p className="whitespace-pre-wrap break-words text-xs leading-6 text-[#606266]">
                                              {requirement.description}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    ) : !currentBoundRequirementText ? (
                                      <p className="text-xs leading-6 text-[#909399]">
                                        当前章节暂未匹配到可展示的原始招标要求，请结合左侧章节导航和解析结果继续编写。
                                      </p>
                                    ) : null}
                                  </ScrollArea>
                                  )}
                                </TabsContent>

                                <TabsContent value="format" className="mt-0 px-3 pb-3 pt-3">
                                  {sourcePreviewState.status === "loading" ? (
                                    <div className="flex h-[360px] items-center justify-center text-sm text-[#909399]">
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      正在加载原文格式...
                                    </div>
                                  ) : sourcePreviewState.status === "error" ? (
                                    <div className="flex h-[360px] items-center justify-center px-6 text-center text-sm text-[#909399]">
                                      {sourcePreviewState.message}
                                    </div>
                                  ) : sourcePreviewState.status === "ready" && sourcePreviewState.preview.kind === "docx" ? (
                                    <div className="h-[420px] overflow-auto rounded-[8px] bg-[#F5F7FA] p-4">
                                      <div ref={docxPreviewRef} className="mx-auto max-w-[920px]" />
                                    </div>
                                  ) : sourcePreviewState.status === "ready" && sourcePreviewState.preview.kind === "pdf" ? (
                                    <iframe
                                      title="招标原文预览"
                                      src={sourcePreviewState.preview.blobUrl}
                                      className="h-[420px] w-full rounded-[8px] border border-[#E4E7ED] bg-white"
                                    />
                                  ) : sourcePreviewState.status === "ready" && sourcePreviewState.preview.kind === "text" ? (
                                    <div className="h-[360px] overflow-auto rounded-[8px] border border-[#E4E7ED] bg-white p-4">
                                      <pre className="whitespace-pre-wrap text-xs leading-6 text-[#303133]">
                                        {sourcePreviewState.preview.textContent}
                                      </pre>
                                    </div>
                                  ) : (
                                    <div className="flex h-[360px] items-center justify-center px-6 text-center text-sm text-[#909399]">
                                      当前文件格式暂不支持在线原文预览，请点击右上角“打开原文件”查看。
                                    </div>
                                  )}
                                </TabsContent>
                              </Tabs>
                            </div>
                          </div>
                          <ProposalRichEditor
                            value={currentSectionDraft?.content || "<p></p>"}
                            onChange={updateCurrentSectionContent}
                            placeholder="选择章节后开始编写。若当前为空，点击“优化标书”会根据招标要求自动生成初稿。"
                          />
                        </>
                      ) : (
                        <div className="rounded-[8px] border border-dashed border-[#D0D7E2] px-4 py-16 text-center text-sm text-[#909399]">
                          请先生成大纲，然后从左侧选择章节开始编写。
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">历史标书复用</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs leading-6 text-[#606266]">
                        系统会按照当前章节标题自动匹配企业库中相近的历史内容。你可以选择复用，再结合“优化标书”让大模型补全或改写。
                      </p>
                      <Button size="sm" variant="outline" onClick={handleReuseSelectedAssets} disabled={selectedAssetIds.length === 0}>
                        复用所选
                      </Button>
                      <div className="rounded-[8px] border border-[#E4E7ED]">
                        <ScrollArea className="h-[520px] px-3 py-3">
                          {loadingRecommendations ? (
                            <div className="flex items-center justify-center py-10 text-sm text-[#909399]">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              正在匹配历史内容...
                            </div>
                          ) : recommendations.length === 0 ? (
                            <div className="py-10 text-center text-sm text-[#909399]">当前章节暂未匹配到可复用内容</div>
                          ) : (
                            <div className="space-y-3">
                              {recommendations.map((item) => (
                                <label key={item.id} className="block rounded-[8px] border border-[#E4E7ED] p-3">
                                  <div className="flex items-start gap-2">
                                    <input
                                      type="checkbox"
                                      className="mt-1"
                                      checked={selectedAssetIds.includes(item.id)}
                                      onChange={() => toggleAssetSelection(item.id)}
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-[#303133]">{item.title}</p>
                                        <Badge variant="outline">{item.category}</Badge>
                                        {typeof item.score === "number" ? <Badge variant="outline">匹配度 {item.score}</Badge> : null}
                                      </div>
                                      <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-[#606266]">
                                        {item.snippet || item.content || "暂无摘要"}
                                      </p>
                                    </div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={optimizeDialogOpen} onOpenChange={setOptimizeDialogOpen}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle>优化标书</DialogTitle>
            <DialogDescription>
              系统会将当前章节的原文绑定文本与你在这里补充的 prompt 一起发送给模型，用于生成或优化当前章节内容。
              系统还会基于整份标书解析结果，自动补充一段评分导向和客户需求导向的写作提示词，但这部分不会在页面上原样展示。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[#E4E7ED] bg-[#F8FAFC] p-3">
              <p className="text-xs font-medium text-[#303133]">当前章节</p>
              <p className="mt-1 text-sm text-[#303133]">
                {currentSection ? `${currentSection.numbering} ${getOutlineDisplayTitle(currentSection.title)}` : "未选择章节"}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-[#303133]">原文绑定文本</p>
                <span className="text-xs text-[#909399]">会优先作为模型生成依据</span>
              </div>
              <div className="max-h-[180px] overflow-auto rounded-[8px] border border-[#E4E7ED] bg-white p-3">
                {effectiveBoundRequirementText ? (
                  <p className="whitespace-pre-wrap break-words text-xs leading-6 text-[#606266]">
                    {effectiveBoundRequirementText}
                  </p>
                ) : (
                  <p className="text-xs leading-6 text-[#909399]">当前章节暂无原文绑定文本，可先在上方“原文绑定文本”中手动粘贴后再生成。</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-[#303133]">补充 prompt</p>
              <Textarea
                value={optimizePrompt}
                onChange={(event) => setOptimizePrompt(event.target.value)}
                className="min-h-[140px]"
                placeholder="可选填写，例如：突出实施周期、强调团队经验、不要写空泛表述、语言更正式一些。"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOptimizeDialogOpen(false);
                setOptimizePrompt("");
              }}
              disabled={isOptimizing}
            >
              取消
            </Button>
            <Button onClick={() => void handleOptimizeSection()} disabled={!currentSection || isOptimizing}>
              {isOptimizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              生成标书
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outlineEditorOpen} onOpenChange={setOutlineEditorOpen}>
        <DialogContent className="max-h-[90vh] max-w-[1100px] overflow-hidden">
          <DialogHeader>
            <DialogTitle>大纲生成结果调整</DialogTitle>
            <DialogDescription>
              你可以修改技术标和商务标的大纲标题、说明、层级结构。保存后，章节导航会立即按这里的结果刷新。
            </DialogDescription>
          </DialogHeader>
          <Tabs value={activeKind} onValueChange={(value) => setActiveKind(value as BidKind)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="tech">技术标大纲</TabsTrigger>
              <TabsTrigger value="biz">商务标大纲</TabsTrigger>
            </TabsList>
            {(["tech", "biz"] as const).map((kind) => (
              <TabsContent key={kind} value={kind} className="mt-4">
                <ScrollArea className="h-[60vh] pr-4">
                  <div className="space-y-4">
                    {outlineDraft[kind].map((group, groupIndex) => (
                      <div key={group.id} className="space-y-3 rounded-[12px] border border-[#DCE3F0] bg-[#F8FAFC] p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={group.group}
                            onChange={(event) => {
                              const next = [...outlineDraft[kind]];
                              next[groupIndex] = { ...group, group: event.target.value };
                              updateDraftGroups(kind, next);
                            }}
                            className="max-w-[240px] bg-white"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const next = [...outlineDraft[kind]];
                              next[groupIndex] = {
                                ...group,
                                sections: [
                                  ...group.sections,
                                  {
                                    id: `node-${Date.now()}`,
                                    title: "一级标题",
                                    detail: "",
                                    children: [],
                                  },
                                ],
                              };
                              updateDraftGroups(kind, next);
                            }}
                          >
                            <Plus className="mr-1 h-4 w-4" />
                            新增一级标题
                          </Button>
                        </div>
                        <div className="space-y-3">
                          {group.sections.map((node) => (
                            <OutlineEditorNode
                              key={node.id}
                              node={node}
                              level={1}
                              onTitleChange={(nodeId, title) => updateDraftNodeTitle(kind, nodeId, title)}
                              onDetailChange={(nodeId, detail) => updateDraftNodeDetail(kind, nodeId, detail)}
                              onAddSibling={(nodeId) => updateDraftGroups(kind, addOutlineSibling(outlineDraft[kind], nodeId))}
                              onAddChild={(nodeId) => updateDraftGroups(kind, addOutlineChild(outlineDraft[kind], nodeId))}
                              onMoveUp={(nodeId) => updateDraftGroups(kind, moveOutlineNode(outlineDraft[kind], nodeId, "up"))}
                              onMoveDown={(nodeId) => updateDraftGroups(kind, moveOutlineNode(outlineDraft[kind], nodeId, "down"))}
                              onRemove={(nodeId) => updateDraftGroups(kind, removeOutlineNode(outlineDraft[kind], nodeId))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutlineEditorOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveOutline} disabled={isSavingOutline}>
              {isSavingOutline ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              保存并同步章节导航
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
