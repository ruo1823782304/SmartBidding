import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Upload, FileText, CheckCircle, AlertCircle, FileSearch } from "lucide-react";
import { BidSection, BID_STRUCTURE, flattenBidStructure } from "../utils/bidStructure";

export interface TenderRequirement {
  id: string;
  sectionId: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  required: boolean;
}

interface TenderAnalyzerProps {
  onAnalysisComplete: (requirements: TenderRequirement[]) => void;
}

export function TenderAnalyzer({ onAnalysisComplete }: TenderAnalyzerProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [requirements, setRequirements] = useState<TenderRequirement[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);

    // 模拟招标书分析过程
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 生成模拟的招标要求
    const mockRequirements: TenderRequirement[] = [
      {
        id: "req-1",
        sectionId: "part1-2-1",
        title: "企业营业执照",
        description: "提供有效的企业法人营业执照（三证合一），要求在有效期内",
        priority: "high",
        required: true,
      },
      {
        id: "req-2",
        sectionId: "part1-3-1",
        title: "财务状况证明",
        description: "提供2021-2023年度财务审计报告，证明企业财务状况良好",
        priority: "high",
        required: true,
      },
      {
        id: "req-3",
        sectionId: "part1-3-5",
        title: "同类项目业绩",
        description: "提供近三年内至少2个监管数据报送系统或金融科技类项目业绩，需附合同关键页和验收报告",
        priority: "high",
        required: true,
      },
      {
        id: "req-4",
        sectionId: "part1-3-10",
        title: "企业资质认证",
        description: "要求具备ISO9001质量管理体系认证、ISO27001信息安全认证，CMMI3级及以上优先",
        priority: "high",
        required: true,
      },
      {
        id: "req-5",
        sectionId: "part1-3-9",
        title: "信创适配证书",
        description: "提供与国产操作系统、数据库的适配认证证书",
        priority: "medium",
        required: false,
      },
      {
        id: "req-6",
        sectionId: "part2-3-1",
        title: "项目工期承诺",
        description: "项目要求在6个月内完成，需明确各阶段时间节点",
        priority: "high",
        required: true,
      },
      {
        id: "req-7",
        sectionId: "part2-3-2",
        title: "质保期承诺",
        description: "要求提供不少于2年的免费质保服务，包括系统维护、Bug修复等",
        priority: "high",
        required: true,
      },
      {
        id: "req-8",
        sectionId: "part2-4-1",
        title: "项目团队配置",
        description: "项目经理需具备PMP或信息系统项目管理师证书，核心开发人员不少于5人，需提供社保证明",
        priority: "high",
        required: true,
      },
      {
        id: "req-9",
        sectionId: "part3-2-1",
        title: "项目背景理解",
        description: "针对监管数据报送场景，说明对项目背景、业务需求的理解",
        priority: "high",
        required: true,
      },
      {
        id: "req-10",
        sectionId: "part3-3-1",
        title: "系统架构设计",
        description: "提供详细的系统总体架构设计方案，包括技术架构、部署架构、数据架构",
        priority: "high",
        required: true,
      },
      {
        id: "req-11",
        sectionId: "part3-3-2",
        title: "信创环境适配方案",
        description: "说明系统如何适配信创环境，包括国产操作系统（如麒麟、统信）、国产数据库（如达梦、人大金仓）",
        priority: "high",
        required: true,
      },
      {
        id: "req-12",
        sectionId: "part3-3-3",
        title: "数据处理流程设计",
        description: "详细说明数据采集、清洗、校验、报送、归档的完整流程和技术实现",
        priority: "high",
        required: true,
      },
      {
        id: "req-13",
        sectionId: "part3-4-1",
        title: "实施方法论",
        description: "提供项目实施方法论，包括需求调研、设计开发、测试验收等各阶段的详细计划",
        priority: "medium",
        required: true,
      },
      {
        id: "req-14",
        sectionId: "part3-5-3",
        title: "信息安全方案",
        description: "提供完整的信息安全保障方案，包括数据加密、访问控制、审计日志、容灾备份等",
        priority: "high",
        required: true,
      },
      {
        id: "req-15",
        sectionId: "part3-6-3",
        title: "服务响应标准",
        description: "明确服务响应时间和处理时效，紧急问题2小时响应、4小时解决",
        priority: "medium",
        required: true,
      },
      {
        id: "req-16",
        sectionId: "part3-8-1",
        title: "用户培训计划",
        description: "提供详细的用户培训方案，包括培训内容、培训时间、培训方式、考核标准",
        priority: "medium",
        required: true,
      },
      {
        id: "req-17",
        sectionId: "part3-10-1",
        title: "成功案例展示",
        description: "提供近三年同类监管数据报送系统项目案例，包括项目背景、实施内容、验收情况",
        priority: "high",
        required: true,
      },
      {
        id: "req-18",
        sectionId: "part4-2-1",
        title: "项目总报价",
        description: "项目预算上限为500万元（含税），需提供详细报价清单",
        priority: "high",
        required: true,
      },
      {
        id: "req-19",
        sectionId: "part4-3-1",
        title: "费用明细说明",
        description: "提供软件开发、实施服务、培训、运维等各项费用的详细拆分",
        priority: "high",
        required: true,
      },
    ];

    setRequirements(mockRequirements);
    setIsAnalyzing(false);
    onAnalysisComplete(mockRequirements);
  };

  const getStatistics = () => {
    const total = requirements.length;
    const highPriority = requirements.filter(r => r.priority === "high").length;
    const required = requirements.filter(r => r.required).length;
    
    return { total, highPriority, required };
  };

  const stats = getStatistics();

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="font-semibold mb-4">上传招标书</h3>
        <p className="text-sm text-muted-foreground mb-4">
          上传招标文件，系统将自动分析招标要求并生成响应提纲。
        </p>

        <div className="space-y-4">
          {!selectedFile ? (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                type="file"
                id="tender-upload"
                className="hidden"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.txt"
              />
              <label htmlFor="tender-upload" className="cursor-pointer">
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                <p className="mb-2">点击选择招标文件</p>
                <p className="text-sm text-muted-foreground">支持 PDF, Word, TXT 格式</p>
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
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
                    重新选择
                  </Button>
                  <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                    {isAnalyzing ? "分析中..." : "开始分析"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {requirements.length > 0 && (
        <>
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileSearch className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">招标要求分析</h3>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="p-4 bg-muted/30 rounded-lg">
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">总要求项</p>
              </div>
              <div className="p-4 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {stats.highPriority}
                </p>
                <p className="text-sm text-muted-foreground">高优先级</p>
              </div>
              <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {stats.required}
                </p>
                <p className="text-sm text-muted-foreground">必须响应</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-semibold mb-4">响应提纲（按标书结构分类）</h3>
            <ScrollArea className="h-[500px]">
              <div className="space-y-3">
                {requirements.map((req) => (
                  <div
                    key={req.id}
                    className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {req.required ? (
                          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                        ) : (
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        )}
                        <h4 className="font-medium">{req.title}</h4>
                      </div>
                      <div className="flex gap-2">
                        {req.required && <Badge variant="destructive">必填</Badge>}
                        <Badge
                          variant={
                            req.priority === "high"
                              ? "default"
                              : req.priority === "medium"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {req.priority === "high"
                            ? "高优先级"
                            : req.priority === "medium"
                            ? "中优先级"
                            : "低优先级"}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{req.description}</p>
                    <p className="text-xs text-muted-foreground">
                      对应章节：{req.sectionId}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        </>
      )}
    </div>
  );
}
