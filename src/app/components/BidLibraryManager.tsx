import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Upload, FileText, Trash2, Eye, CheckCircle, FolderOpen } from "lucide-react";
import { BidSection, flattenBidStructure, BID_STRUCTURE } from "../utils/bidStructure";
import { Progress } from "./ui/progress";

export interface BidLibraryItem {
  sectionId: string;
  sectionTitle: string;
  content: string;
  sourceFile: string;
  uploadDate: string;
}

interface BidLibraryManagerProps {
  library: BidLibraryItem[];
  onLibraryUpdate: (items: BidLibraryItem[]) => void;
}

const API_BASE = ""; // 使用相对路径，方便部署到 198.130.0.0 等任意服务器

export function BidLibraryManager({ library, onLibraryUpdate }: BidLibraryManagerProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [isSyncingToBackend, setIsSyncingToBackend] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<{
    updatedAt: string;
    sectionCount: number;
    outlineNote?: string;
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const readFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
      reader.readAsText(file);
    });

  // 初始化时尝试获取最近一次“表达片段库”分析信息
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/library/snippet-library`);
        if (!resp.ok) return;
        const json = await resp.json();
        if (json?.success && json.data) {
          setAnalysisSummary(json.data);
        }
      } catch {
        // 忽略初始化失败，用户手动点“分析”即可
      }
    };
    fetchSummary();
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setProcessingProgress(0);

    // 先尝试把整份标书文本同步到后端“标书库”
    try {
      setIsSyncingToBackend(true);
      const content = await readFileAsText(selectedFile);
      await fetch(`${API_BASE}/api/library/proposals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: selectedFile.name,
          content,
        }),
      });
    } catch (err) {
      // 同步失败不影响前端本地库使用，只在控制台提示
      console.error("[BidLibraryManager] 上传标书到后端失败：", err);
    } finally {
      setIsSyncingToBackend(false);
    }

    // 模拟文档拆解过程
    const newItems: BidLibraryItem[] = [];
    const sections = flattenBidStructure(BID_STRUCTURE);
    
    // 模拟逐个章节处理
    for (let i = 0; i < sections.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      setProcessingProgress(((i + 1) / sections.length) * 100);
      
      const section = sections[i];
      // 只为level 3的章节生成模拟内容
      if (section.level === 3) {
        newItems.push({
          sectionId: section.id,
          sectionTitle: section.title,
          content: generateMockContent(section.title),
          sourceFile: selectedFile.name,
          uploadDate: new Date().toISOString(),
        });
      }
    }

    onLibraryUpdate([...library, ...newItems]);
    setIsProcessing(false);
    setSelectedFile(null);
  };

  const handleAnalyzeLibrary = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const resp = await fetch(`${API_BASE}/api/library/analyze`, {
        method: "POST",
      });
      const json = await resp.json();
      if (!resp.ok || !json?.success) {
        throw new Error(json?.message || "分析标书库失败");
      }
      setAnalysisSummary(json.data);
    } catch (err: any) {
      setAnalysisError(err?.message || "分析标书库失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateMockContent = (sectionTitle: string): string => {
    const templates: Record<string, string> = {
      "企业法人营业执照": "统一社会信用代码：91XXXXXXXXXXXXXXXXX\n企业名称：XX科技股份有限公司\n注册资本：5000万元人民币\n成立日期：2010年6月15日",
      "法定代表人身份证明": "法定代表人：张三\n身份证号：110XXXXXXXXXXXXXXXXX\n职务：董事长兼总经理",
      "近三年财务状况报告": "2023年度营业收入：2.5亿元，净利润：3500万元\n2022年度营业收入：2.1亿元，净利润：3000万元\n2021年度营业收入：1.8亿元，净利润：2500万元\n财务状况良好，资产负债率保持在合理水平。",
      "同类项目业绩表": "项目一：某银行监管数据报送系统（2023年，合同金额：800万元）\n项目二：某证券公司数据治理平台（2022年，合同金额：600万元）\n项目三：某保险公司监管报表系统（2022年，合同金额：500万元）",
      "系统总体架构设计": "采用微服务架构，分为数据接入层、数据处理层、业务逻辑层和展示层。\n• 数据接入层：支持多源异构数据统一接入，包括数据库直连、文件导入、接口对接等方式\n• 数据处理层：实现数据清洗、转换、校验、聚合等ETL功能\n• 业务逻辑层：包含报表引擎、规则引擎、任务调度、监控告警等核心模块\n• 展示层：提供Web管理端和移动端，支持报表查询、数据展示、系统配置等功能",
      "项目负责人及其他项目实施人员一览表": "项目经理：张明，PMP认证，15年项目管理经验\n技术总监：李建华，高级工程师，12年架构设计经验\n开发工程师：5人，平均5年以上开发经验\n测试工程师：2人，精通自动化测试\n实施工程师：2人，熟悉金融业务",
    };

    // 如果有精确匹配的模板，使用模板
    for (const [key, value] of Object.entries(templates)) {
      if (sectionTitle.includes(key)) {
        return value;
      }
    }

    // 否则生成通用内容
    return `【${sectionTitle}】的详细内容。\n\n本部分包含以下关键信息：\n1. 符合招标文件要求的具体内容\n2. 相关证明材料和支持文档\n3. 详细说明和补充信息\n\n（本内容来自历史投标书模板，可根据具体项目需求进行调整和完善）`;
  };

  const handleDeleteItem = (sectionId: string) => {
    onLibraryUpdate(library.filter(item => item.sectionId !== sectionId));
  };

  const getCoverageSummary = () => {
    const allSections = flattenBidStructure(BID_STRUCTURE).filter(s => s.level === 3);
    const coveredSections = new Set(library.map(item => item.sectionId));
    const coverage = (coveredSections.size / allSections.length) * 100;
    
    return {
      total: allSections.length,
      covered: coveredSections.size,
      coverage: Math.round(coverage),
    };
  };

  const summary = getCoverageSummary();

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="font-semibold mb-4">上传历史投标书</h3>
        <p className="text-sm text-muted-foreground mb-4">
          上传您的历史投标书文档，系统将按照标准目录结构自动拆解并保存到标书库中。
        </p>
        {isSyncingToBackend && (
          <p className="text-xs text-muted-foreground mb-2">
            正在将整份标书同步到后端标书库，用于后续大模型分析…
          </p>
        )}

        {!isProcessing ? (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-6">
              <input
                type="file"
                id="library-upload"
                className="hidden"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.txt"
              />
              
              {!selectedFile ? (
                <label htmlFor="library-upload" className="cursor-pointer">
                  <div className="text-center">
                    <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-2" />
                    <p className="text-sm mb-2">点击选择文件</p>
                    <p className="text-xs text-muted-foreground">支持 PDF, Word, TXT 格式</p>
                  </div>
                </label>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-primary" />
                    <div>
                      <p className="font-medium">{selectedFile.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setSelectedFile(null)}>
                      取消
                    </Button>
                    <Button onClick={handleFileUpload}>
                      开始拆解
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>正在拆解文档...</span>
              <span className="font-medium">{Math.round(processingProgress)}%</span>
            </div>
            <Progress value={processingProgress} />
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">标书库概览</h3>
            <p className="text-sm text-muted-foreground mt-1">
              已收录 {summary.covered} / {summary.total} 个章节
            </p>
            {analysisSummary && (
              <p className="text-xs text-muted-foreground mt-1">
                最近一次“表达片段库”分析：{new Date(analysisSummary.updatedAt).toLocaleString()}
                ，共 {analysisSummary.sectionCount} 个小节
              </p>
            )}
            {analysisError && (
              <p className="text-xs text-destructive mt-1">分析失败：{analysisError}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-lg px-4 py-2">
              覆盖率 {summary.coverage}%
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAnalyzeLibrary}
              disabled={isAnalyzing || library.length === 0}
            >
              {isAnalyzing ? "分析中..." : "分析标书库"}
            </Button>
          </div>
        </div>

        <div className="mb-4">
          <Progress value={summary.coverage} className="h-2" />
        </div>

        <ScrollArea className="h-[400px]">
          {library.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FolderOpen className="h-16 w-16 mb-4" />
              <p>标书库为空，请上传历史投标书</p>
            </div>
          ) : (
            <div className="space-y-2">
              {library.map((item, index) => (
                <div
                  key={index}
                  className="flex items-start justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <p className="font-medium text-sm truncate">{item.sectionTitle}</p>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {item.content.substring(0, 100)}...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      来源：{item.sourceFile}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteItem(item.sectionId)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
