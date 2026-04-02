import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  Download,
  FileSearch,
  FileStack,
  FolderArchive,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import {
  confirmIngestItem,
  createIngestJob,
  deleteAsset,
  deleteIngestItem,
  deleteIngestJob,
  downloadAssetFile,
  finalizeIngestJob,
  getIngestJob,
  listAssets,
  listIngestJobs,
  uploadAssetFile,
} from "../lib/asset-library";
import type {
  AssetCategory,
  EnterpriseAsset,
  LibraryIngestItem,
  LibraryIngestJobDetail,
  LibraryIngestJobSummary,
} from "../types/asset-library";

const CATEGORY_LABELS: { key: AssetCategory; label: string }[] = [
  { key: "ingest", label: "标书入库" },
  { key: "qualification", label: "企业资质" },
  { key: "performance", label: "项目业绩" },
  { key: "solution", label: "技术方案" },
  { key: "archive", label: "标书归档" },
  { key: "winning", label: "中标案例" },
  { key: "resume", label: "人员简历" },
];

const QUALIFICATION_CARDS = [
  { subtype: "company_basic_form", label: "公司基本情况表", description: "自动沉淀基础工商与主体信息。" },
  { subtype: "company_profile", label: "公司简介", description: "沉淀历史标书里的公司介绍章节。" },
  { subtype: "qualification_list", label: "公司资质清单", description: "沉淀证书、荣誉、认证等材料。" },
  { subtype: "customer_share", label: "客户占有率", description: "沉淀客户覆盖、市场占有率等内容。" },
  { subtype: "regulator_case", label: "与监管合作案例", description: "沉淀监管合作与报送项目案例。" },
  { subtype: "org_structure", label: "公司组织架构", description: "沉淀组织架构图或组织说明。" },
] as const;

const SUBTYPE_LABELS: Record<string, string> = {
  company_basic_form: "公司基本情况表",
  company_profile: "公司简介",
  qualification_list: "公司资质清单",
  customer_share: "客户占有率",
  regulator_case: "与监管合作案例",
  org_structure: "公司组织架构",
  technical_solution: "技术方案",
  project_performance: "项目业绩",
  person_resume: "人员简历",
  winning_case: "中标案例",
  ingest_source: "入库源文件",
  archive_original: "归档镜像",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  running: "处理中",
  succeeded: "已完成",
  partial_review: "部分待确认",
  failed: "失败",
  completed: "已入库",
  pending_review: "待确认",
};

const CATEGORY_TO_DEFAULT_SUBTYPE: Record<string, string> = {
  qualification: "company_profile",
  performance: "project_performance",
  solution: "technical_solution",
  winning: "winning_case",
  resume: "person_resume",
  archive: "archive_original",
  ingest: "ingest_source",
};

const CATEGORY_UPLOAD_ACCEPTS: Record<Exclude<AssetCategory, "ingest">, string> = {
  qualification: ".doc,.docx,.pdf,.jpg,.jpeg,.png",
  performance: ".doc,.docx,.pdf,.xls,.xlsx",
  solution: ".doc,.docx,.pdf",
  archive: ".doc,.docx,.pdf",
  winning: ".doc,.docx,.pdf",
  resume: ".doc,.docx,.pdf",
};

const QUALIFICATION_UPLOAD_ACCEPTS: Record<string, string> = {
  company_basic_form: ".doc,.docx,.pdf",
  company_profile: ".doc,.docx,.pdf",
  qualification_list: ".doc,.docx,.pdf,.jpg,.jpeg,.png",
  customer_share: ".doc,.docx,.pdf,.jpg,.jpeg,.png",
  regulator_case: ".doc,.docx,.pdf",
  org_structure: ".doc,.docx,.pdf,.jpg,.jpeg,.png",
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function getStatusTone(status: string) {
  if (status === "failed") return "destructive" as const;
  if (status === "succeeded" || status === "completed") return "default" as const;
  if (status === "partial_review" || status === "pending_review") return "secondary" as const;
  return "outline" as const;
}

function getCategoryLabel(category: string) {
  return CATEGORY_LABELS.find((item) => item.key === category)?.label ?? category;
}

function getSubtypeLabel(subtype?: string) {
  if (!subtype) return "—";
  return SUBTYPE_LABELS[subtype] ?? subtype;
}

function downloadLabelForAsset(asset: Pick<EnterpriseAsset, "title">) {
  return asset.title.endsWith(".docx") ? asset.title : `${asset.title}.docx`;
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

export function EnterpriseLibraryPage({
  activeCategory,
  onCategoryChange,
}: {
  activeCategory: AssetCategory;
  onCategoryChange: (value: AssetCategory) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [jobs, setJobs] = useState<LibraryIngestJobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobDetail, setSelectedJobDetail] = useState<LibraryIngestJobDetail | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [ingestUploading, setIngestUploading] = useState(false);
  const [categoryAssets, setCategoryAssets] = useState<EnterpriseAsset[]>([]);
  const [confirmingItem, setConfirmingItem] = useState<LibraryIngestItem | null>(null);
  const [confirmCategory, setConfirmCategory] = useState<AssetCategory>("qualification");
  const [confirmSubtype, setConfirmSubtype] = useState("company_profile");
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [manualUploadingKey, setManualUploadingKey] = useState<string | null>(null);
  const [finalizingJob, setFinalizingJob] = useState(false);

  const refreshJobs = async (preferredJobId?: string | null) => {
    const response = await listIngestJobs();
    setJobs(response.list);
    const preferredId = preferredJobId === undefined ? (selectedJobId ?? null) : preferredJobId;
    const nextId = preferredId && response.list.some((job) => job.id === preferredId)
      ? preferredId
      : response.list[0]?.id ?? null;
    setSelectedJobId(nextId);
    return nextId;
  };

  const loadJobDetail = async (jobId: string) => {
    setJobLoading(true);
    try {
      const detail = await getIngestJob(jobId);
      setSelectedJobDetail(detail);
      return detail;
    } finally {
      setJobLoading(false);
    }
  };

  const loadCategoryAssets = async (category: AssetCategory) => {
    if (category === "ingest") {
      return;
    }
    setAssetsLoading(true);
    try {
      const response = await listAssets({
        category,
        pageSize: category === "qualification" ? 100 : 50,
      });
      setCategoryAssets(response.list);
    } finally {
      setAssetsLoading(false);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const nextJobId = await refreshJobs();
        if (nextJobId) {
          await loadJobDetail(nextJobId);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "加载标书入库任务失败");
      }
    };
    void bootstrap();
  }, []);

  useEffect(() => {
    if (activeCategory === "ingest") {
      return;
    }
    void loadCategoryAssets(activeCategory).catch((error) => {
      toast.error(error instanceof Error ? error.message : "加载企业库数据失败");
    });
  }, [activeCategory]);

  useEffect(() => {
    if (activeCategory !== "ingest" || !selectedJobDetail?.job) {
      return;
    }
    const status = selectedJobDetail.job.status;
    if (status !== "pending" && status !== "running") {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const nextId = await refreshJobs(selectedJobDetail.job.id);
        await loadJobDetail(selectedJobDetail.job.id);
        if (nextId && nextId !== selectedJobDetail.job.id) {
          await loadJobDetail(nextId);
        }
      } catch {
        // ignore poll errors
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [activeCategory, selectedJobDetail]);

  const qualificationGroups = useMemo(() => {
    const map = new Map<string, EnterpriseAsset[]>();
    for (const card of QUALIFICATION_CARDS) {
      map.set(card.subtype, []);
    }
    for (const asset of categoryAssets) {
      const key = asset.subtype ?? "";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(asset);
    }
    return map;
  }, [categoryAssets]);

  const handleUpload = async (file: File) => {
    setIngestUploading(true);
    try {
      const detail = await createIngestJob(file);
      setSelectedJobId(detail.job.id);
      setSelectedJobDetail(detail);
      await refreshJobs(detail.job.id);
      toast.success("历史标书已提交入库任务，系统正在后台拆分入库");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建入库任务失败");
    } finally {
      setIngestUploading(false);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  };

  const handleManualUpload = async (input: {
    key: string;
    category: AssetCategory;
    subtype?: string;
    accept?: string;
    multiple?: boolean;
    label: string;
  }) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = input.accept ?? CATEGORY_UPLOAD_ACCEPTS[input.category as Exclude<AssetCategory, "ingest">] ?? ".doc,.docx,.pdf";
    picker.multiple = input.multiple ?? true;
    picker.onchange = async () => {
      const files = Array.from(picker.files ?? []);
      if (!files.length) {
        return;
      }

      setManualUploadingKey(input.key);
      try {
        for (const file of files) {
          await uploadAssetFile({
            category: input.category,
            subtype: input.subtype,
            file,
            title: stripExtension(file.name),
          });
        }
        await loadCategoryAssets(input.category);
        toast.success(`${input.label}已上传 ${files.length} 个文件`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `${input.label}上传失败`);
      } finally {
        setManualUploadingKey(null);
      }
    };
    picker.click();
  };

  const handleDownload = async (asset: Pick<EnterpriseAsset, "id" | "title">) => {
    try {
      await downloadAssetFile(asset.id, downloadLabelForAsset(asset));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!window.confirm("删除后会同时移除该入库任务、任务结果和对应企业库文件，确定继续吗？")) {
      return;
    }

    try {
      await deleteIngestJob(jobId);
      const nextJobId = await refreshJobs(selectedJobId === jobId ? null : selectedJobId ?? undefined);
      if (nextJobId) {
        await loadJobDetail(nextJobId);
      } else {
        setSelectedJobId(null);
        setSelectedJobDetail(null);
      }
      toast.success("入库任务已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除入库任务失败");
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm("删除后会同步移除这条拆分内容及其下载文件，确定继续吗？")) {
      return;
    }

    try {
      const detail = await deleteIngestItem(itemId);
      setSelectedJobId(detail.job.id);
      setSelectedJobDetail(detail);
      await refreshJobs(detail.job.id);
      toast.success("拆分条目已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除拆分条目失败");
    }
  };

  const handleDeleteAsset = async (assetId: string, category: AssetCategory) => {
    if (!window.confirm("删除后会移除这条企业库记录及其下载文件，确定继续吗？")) {
      return;
    }

    try {
      await deleteAsset(assetId);
      await loadCategoryAssets(category);
      if (selectedJobId) {
        await refreshJobs(selectedJobId);
      }
      toast.success("企业库记录已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除企业库记录失败");
    }
  };

  const openConfirmDialog = (item: LibraryIngestItem) => {
    const nextCategory = (item.suggestedCategory ?? "qualification") as AssetCategory;
    setConfirmingItem(item);
    setConfirmCategory(nextCategory);
    setConfirmSubtype(item.suggestedSubtype ?? CATEGORY_TO_DEFAULT_SUBTYPE[nextCategory] ?? "company_profile");
    setConfirmTitle(item.suggestedTitle ?? "");
  };

  const handleConfirmItem = async () => {
    if (!confirmingItem) return;
    setConfirmSubmitting(true);
    try {
      const detail = await confirmIngestItem(confirmingItem.id, {
        targetCategory: confirmCategory,
        targetSubtype: confirmSubtype,
        title: confirmTitle,
      });
      setSelectedJobId(detail.job.id);
      setSelectedJobDetail(detail);
      await refreshJobs(detail.job.id);
      toast.success("待确认条目已正式入库");
      setConfirmingItem(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认入库失败");
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const handleFinalizeJob = async () => {
    if (!selectedJobDetail?.job) {
      return;
    }

    if (!window.confirm("确认后，这份标书会被视为正式入库完成，当前入库页会清空并准备接收下一份标书。确定继续吗？")) {
      return;
    }

    setFinalizingJob(true);
    try {
      await finalizeIngestJob(selectedJobDetail.job.id);
      const nextJobId = await refreshJobs(null);
      if (nextJobId) {
        await loadJobDetail(nextJobId);
      } else {
        setSelectedJobId(null);
        setSelectedJobDetail(null);
      }
      toast.success("当前标书已正式入库完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认本标书入库完成失败");
    } finally {
      setFinalizingJob(false);
    }
  };

  const renderCategoryRecords = () => {
    if (assetsLoading) {
      return (
        <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载企业库数据
        </div>
      );
    }

    if (activeCategory === "qualification") {
      return (
        <div className="space-y-4">
          <div className="rounded-[18px] border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-slate-600">
            企业资质页已经接入真实入库数据。每个内容项都支持手工上传，也会优先展示历史标书自动拆分后的最新 Word。
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
            {QUALIFICATION_CARDS.map((card) => {
              const records = qualificationGroups.get(card.subtype) ?? [];
              const latest = records[0];
              return (
                <Card key={card.subtype} className="overflow-hidden border-[#E5E7EB]">
                  <CardHeader className="border-b border-[#EEF2F7] pb-3">
                    <CardTitle className="text-[17px] text-[#1E3A5F]">{card.label}</CardTitle>
                    <p className="text-xs text-slate-500">{card.description}</p>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={records.length ? "default" : "outline"}>
                        {records.length ? `已入库 ${records.length} 份` : "暂无记录"}
                      </Badge>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            void handleManualUpload({
                              key: `qualification:${card.subtype}`,
                              category: "qualification",
                              subtype: card.subtype,
                              accept: QUALIFICATION_UPLOAD_ACCEPTS[card.subtype] ?? CATEGORY_UPLOAD_ACCEPTS.qualification,
                              multiple: true,
                              label: `${card.label}`,
                            })
                          }
                          disabled={manualUploadingKey === `qualification:${card.subtype}`}
                        >
                          <UploadCloud className="mr-1 h-4 w-4" />
                          {manualUploadingKey === `qualification:${card.subtype}` ? "上传中..." : "上传"}
                        </Button>
                        {latest?.downloadable ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void handleDownload(latest)}>
                              <Download className="mr-1 h-4 w-4" />
                              下载最新
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => void handleDeleteAsset(latest.id, "qualification")}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              删除
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {latest ? (
                      <div className="space-y-2">
                        {records.slice(0, 3).map((record) => (
                          <div key={record.id} className="space-y-2 rounded-[14px] bg-slate-50 p-3 text-sm">
                            <p className="font-medium text-slate-900">{record.title}</p>
                            <p className="line-clamp-3 text-xs leading-6 text-slate-600">
                              {record.snippet || "已生成独立 Word，可直接复用。"}
                            </p>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                              <span>最近入库：{formatDateTime(record.uploadedAt)}</span>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!record.downloadable}
                                  onClick={() => void handleDownload(record)}
                                >
                                  <Download className="mr-1 h-4 w-4" />
                                  下载
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={() => void handleDeleteAsset(record.id, "qualification")}
                                >
                                  <Trash2 className="mr-1 h-4 w-4" />
                                  删除
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[14px] border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                        暂无记录。你可以直接上传文件手工归档，或者上传历史标书后让系统自动拆分落库。
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      );
    }

    if (!categoryAssets.length) {
      return (
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[20px] border border-dashed border-[#D8E1F0] bg-[#F8FAFC] text-center">
          <FolderArchive className="mb-3 h-10 w-10 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">当前分类还没有自动入库记录</p>
          <p className="mt-2 text-xs text-slate-500">
            你可以先手工上传文件归档，或者去“标书入库”上传历史标书，系统拆分完成后也会自动同步到这里。
          </p>
          <Button
            className="mt-4"
            onClick={() =>
              void handleManualUpload({
                key: `category:${activeCategory}`,
                category: activeCategory,
                subtype: CATEGORY_TO_DEFAULT_SUBTYPE[activeCategory],
                accept: CATEGORY_UPLOAD_ACCEPTS[activeCategory as Exclude<AssetCategory, "ingest">],
                multiple: true,
                label: getCategoryLabel(activeCategory),
              })
            }
            disabled={manualUploadingKey === `category:${activeCategory}`}
          >
            <UploadCloud className="mr-1 h-4 w-4" />
            {manualUploadingKey === `category:${activeCategory}` ? "上传中..." : "上传文件"}
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-[18px] border border-[#E5E7EB] bg-[#F8FAFC] p-4 text-sm text-slate-600">
          当前分类共沉淀 <span className="font-semibold text-slate-900">{categoryAssets.length}</span> 条真实企业库记录，支持手工上传、直接下载自动生成的 Word。
        </div>
        <div className="overflow-hidden rounded-[20px] border border-[#E5E7EB]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>子类</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>上传时间</TableHead>
                <TableHead>上传人</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryAssets.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell className="max-w-[320px]">
                    <div className="space-y-1">
                      <p className="truncate font-medium text-slate-900">{asset.title}</p>
                      <p className="line-clamp-2 text-xs text-slate-500">
                        {asset.snippet || "该记录已生成独立文档，可直接下载复用。"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{getSubtypeLabel(asset.subtype)}</TableCell>
                  <TableCell>
                    {asset.sourceMode === "ingest_generated"
                      ? "自动拆分入库"
                      : asset.sourceMode === "ingest_archive"
                        ? "历史标书归档镜像"
                        : "手工上传"}
                  </TableCell>
                  <TableCell>{formatDateTime(asset.uploadedAt)}</TableCell>
                  <TableCell>{asset.uploadedBy || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!asset.downloadable}
                        onClick={() => void handleDownload(asset)}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        下载
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => void handleDeleteAsset(asset.id, activeCategory)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <Card className="border-[#E5E7EB]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">资料分类</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {CATEGORY_LABELS.map((item) => (
            <button
              key={item.key}
              onClick={() => onCategoryChange(item.key)}
              className={`flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-left text-sm transition ${
                activeCategory === item.key
                  ? "bg-[#EAF2FF] font-medium text-[#165DFF]"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span>{item.label}</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          ))}
        </CardContent>
      </Card>

      {activeCategory === "ingest" ? (
        <div className="grid gap-4">
          <Card className="border-[#E5E7EB]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-[18px] text-[#1E3A5F]">标书入库</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    上传历史标书后，系统会自动拆分资料分类内容并生成独立 Word 入库。
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void refreshJobs(selectedJobId ?? undefined)}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  刷新任务
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void handleUpload(file);
                }}
              />
              <button
                type="button"
                className="flex w-full flex-col items-center justify-center rounded-[20px] border border-dashed border-[#C9D7F2] bg-[linear-gradient(180deg,#F6F8FF_0%,#EEF4FF_100%)] px-6 py-10 text-center transition hover:border-[#9EB6E8]"
                onClick={() => uploadInputRef.current?.click()}
                disabled={ingestUploading}
              >
                {ingestUploading ? (
                  <Loader2 className="mb-3 h-8 w-8 animate-spin text-[#165DFF]" />
                ) : (
                  <UploadCloud className="mb-3 h-8 w-8 text-[#165DFF]" />
                )}
                <p className="text-base font-semibold text-[#165DFF]">
                  {ingestUploading ? "正在创建入库任务" : "点击上传历史标书文件"}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  仅支持 `.docx`，这样才能保证拆分下载后的格式、表格、字体与原标书保持一致
                </p>
              </button>
            </CardContent>
          </Card>

          <div className="rounded-[18px] border border-[#E5E7EB]">
            <div className="flex items-center justify-between border-b border-[#EEF2F7] px-4 py-3">
              <p className="text-sm font-medium text-slate-900">入库任务</p>
              <Badge variant="outline">{jobs.length} 条</Badge>
            </div>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 p-3">
                {jobs.length ? jobs.map((job) => (
                  <div
                    key={job.id}
                    className={`rounded-[16px] border px-3 py-3 transition ${
                      selectedJobId === job.id
                        ? "border-[#165DFF] bg-[#F4F8FF]"
                        : "border-transparent bg-white hover:border-[#D8E1F0] hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedJobId(job.id);
                          void loadJobDetail(job.id).catch((error) => {
                            toast.error(error instanceof Error ? error.message : "加载任务详情失败");
                          });
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{job.sourceFileName}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatDateTime(job.createdAt)}</p>
                          </div>
                          <Badge variant={getStatusTone(job.status)}>{STATUS_LABELS[job.status] ?? job.status}</Badge>
                        </div>
                        <div className="mt-3 space-y-2">
                          <Progress value={job.progress} />
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>已生成 {job.successCount} 条</span>
                            <span>待确认 {job.unresolvedCount} 条</span>
                          </div>
                        </div>
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 whitespace-nowrap text-red-600 hover:text-red-700"
                        onClick={() => void handleDeleteJob(job.id)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        删除任务
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="flex h-[240px] flex-col items-center justify-center text-center text-sm text-slate-500">
                    <Archive className="mb-3 h-8 w-8 text-slate-400" />
                    暂无入库任务，先上传一份历史标书。
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="rounded-[18px] border border-[#E5E7EB]">
            <div className="border-b border-[#EEF2F7] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-900">任务结果</p>
                {selectedJobDetail?.job && (
                  <Badge variant={getStatusTone(selectedJobDetail.job.status)}>
                    {STATUS_LABELS[selectedJobDetail.job.status] ?? selectedJobDetail.job.status}
                  </Badge>
                )}
              </div>
            </div>
            <ScrollArea className="h-[560px]">
              {jobLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在加载任务详情
                </div>
              ) : selectedJobDetail ? (
                <div className="space-y-4 p-4">
                  <div className="rounded-[16px] bg-[#F8FAFC] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">进度 {selectedJobDetail.job.progress}%</Badge>
                      <Badge variant="outline">{selectedJobDetail.job.archiveMirrored ? "已同步归档镜像" : "归档同步中"}</Badge>
                      <Badge variant="outline">已生成 {selectedJobDetail.job.successCount}</Badge>
                      <Badge variant="outline">待确认 {selectedJobDetail.job.unresolvedCount}</Badge>
                    </div>
                    {selectedJobDetail.job.errorMessage && (
                      <p className="mt-3 text-sm text-red-600">{selectedJobDetail.job.errorMessage}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedJobDetail.sourceAsset?.downloadable && (
                        <Button size="sm" variant="outline" onClick={() => void handleDownload(selectedJobDetail.sourceAsset!)}>
                          下载原始标书
                        </Button>
                      )}
                      {selectedJobDetail.archiveAsset?.downloadable && (
                        <Button size="sm" variant="outline" onClick={() => void handleDownload(selectedJobDetail.archiveAsset!)}>
                          下载归档镜像
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedJobDetail.items.length ? selectedJobDetail.items.map((item) => (
                    <div key={item.id} className="rounded-[16px] border border-[#E5E7EB] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getStatusTone(item.status)}>{STATUS_LABELS[item.status] ?? item.status}</Badge>
                            <Badge variant="outline">{getCategoryLabel(String(item.targetCategory ?? item.suggestedCategory ?? "未分类"))}</Badge>
                            <Badge variant="outline">{getSubtypeLabel(item.targetSubtype ?? item.suggestedSubtype)}</Badge>
                          </div>
                          <p className="text-sm font-medium text-slate-900">{item.finalTitle ?? item.suggestedTitle ?? "待确认命名"}</p>
                          <p className="text-xs text-slate-500">来源章节：{item.sourceOutline || "未识别章节"}</p>
                        </div>
                        <div className="flex gap-2">
                          {item.downloadable && item.assetId && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleDownload({ id: item.assetId!, title: item.finalTitle ?? item.suggestedTitle ?? "生成文件" })}
                            >
                              <Download className="mr-1 h-4 w-4" />
                              下载
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => void handleDeleteItem(item.id)}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            删除
                          </Button>
                          {item.status === "pending_review" && (
                            <Button size="sm" onClick={() => openConfirmDialog(item)}>
                              正式入库
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 rounded-[14px] bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                        {item.sourceQuote || item.content || "未提取到原文片段"}
                      </div>
                    </div>
                  )) : (
                    <div className="flex h-[260px] flex-col items-center justify-center text-center text-sm text-slate-500">
                      <FileSearch className="mb-3 h-8 w-8 text-slate-400" />
                      当前任务还没有产出条目。
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500">
                  <FileStack className="mb-3 h-8 w-8 text-slate-400" />
                  选择左侧任务后查看拆分结果。
                </div>
              )}
            </ScrollArea>
          </div>

          {selectedJobDetail?.job ? (
            <div className="flex flex-col items-end gap-3 rounded-[18px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-4">
              <p className="w-full text-sm text-slate-500">
                确认完成后，这份标书会从当前入库任务区清空，但已正式入库的企业资质、项目业绩、技术方案、标书归档、中标案例和人员简历会保留在对应企业库分类里。
              </p>
              <Button
                onClick={() => void handleFinalizeJob()}
                disabled={
                  finalizingJob ||
                  jobLoading ||
                  selectedJobDetail.job.status === "pending" ||
                  selectedJobDetail.job.status === "running" ||
                  selectedJobDetail.job.status === "failed" ||
                  selectedJobDetail.job.unresolvedCount > 0
                }
              >
                {finalizingJob ? "确认中..." : "确认本标书已正式入库"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <Card className="border-[#E5E7EB]">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-[18px] text-[#1E3A5F]">{getCategoryLabel(activeCategory)}</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {activeCategory === "archive"
                    ? "这里展示历史标书自动同步的归档镜像，以及归档分类下的真实文件。"
                    : "这里展示标书入库自动拆分后落到当前模块的真实企业库记录。"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeCategory !== "qualification" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      void handleManualUpload({
                        key: `category:${activeCategory}`,
                        category: activeCategory,
                        subtype: CATEGORY_TO_DEFAULT_SUBTYPE[activeCategory],
                        accept: CATEGORY_UPLOAD_ACCEPTS[activeCategory as Exclude<AssetCategory, "ingest">],
                        multiple: true,
                        label: getCategoryLabel(activeCategory),
                      })
                    }
                    disabled={manualUploadingKey === `category:${activeCategory}`}
                  >
                    <UploadCloud className="mr-1 h-4 w-4" />
                    {manualUploadingKey === `category:${activeCategory}` ? "上传中..." : "上传"}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => void loadCategoryAssets(activeCategory)}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  刷新
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>{renderCategoryRecords()}</CardContent>
        </Card>
      )}

      <Dialog open={Boolean(confirmingItem)} onOpenChange={(open) => !open && setConfirmingItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>确认待入库条目</DialogTitle>
            <DialogDescription>这条内容还没有被系统完全确认。你可以手工指定分类、子类和最终名称，再把它正式写入企业库。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-[14px] bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {confirmingItem?.sourceQuote || confirmingItem?.content || "未提取到原文片段"}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-900">目标分类</p>
                <select
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={confirmCategory}
                  onChange={(event) => {
                    const nextCategory = event.target.value as AssetCategory;
                    setConfirmCategory(nextCategory);
                    setConfirmSubtype(CATEGORY_TO_DEFAULT_SUBTYPE[nextCategory] ?? "company_profile");
                  }}
                >
                  {CATEGORY_LABELS.filter((item) => item.key !== "ingest").map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-900">目标子类</p>
                <Input value={confirmSubtype} onChange={(event) => setConfirmSubtype(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">最终标题</p>
              <Input value={confirmTitle} onChange={(event) => setConfirmTitle(event.target.value)} />
            </div>
            <div className="rounded-[14px] border border-[#F3D4A5] bg-[#FFF9F0] p-3 text-xs leading-6 text-[#8A5B14]">
              这里我保留了一个不确定点：如果你手工改了分类但子类仍然是旧值，系统会按你当前填写的子类直接入库，所以这里需要你明确确认。
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingItem(null)}>
              取消
            </Button>
            <Button
              disabled={!confirmTitle.trim() || !confirmSubtype.trim() || confirmSubmitting}
              onClick={() => void handleConfirmItem()}
            >
              {confirmSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  入库中
                </>
              ) : (
                "确认入库"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
