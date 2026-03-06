import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  FileDown,
  Sparkles,
  Copy,
  CheckCircle,
  Edit,
  Save,
  X,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { MatchedContent } from "./ContentMatcher";
import { TenderRequirement } from "./TenderAnalyzer";
import { BID_STRUCTURE, flattenBidStructure, BidSection } from "../utils/bidStructure";
import { toast } from "sonner";
import { Alert, AlertDescription } from "./ui/alert";
import { AIConfig } from "./AIAssistant";

export interface ProposalSection {
  id: string;
  sectionId: string;
  title: string;
  content: string;
  status: "generated" | "ai-generated" | "missing" | "edited";
  source: "library" | "ai" | "manual";
  isEditing: boolean;
}

interface ProposalEditorProps {
  matches: MatchedContent[];
  requirements: TenderRequirement[];
  aiConfig: AIConfig;
  onExport: () => void;
  onGenerateWithAI: (requirementId: string, context: string) => Promise<string>;
}

export function ProposalEditor({
  matches,
  requirements,
  aiConfig,
  onExport,
  onGenerateWithAI,
}: ProposalEditorProps) {
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  React.useEffect(() => {
    generateInitialSections();
  }, [matches]);

  const generateInitialSections = () => {
    const newSections: ProposalSection[] = matches.map((match) => {
      const requirement = requirements.find(r => r.id === match.requirementId);
      
      let content = "";
      let status: ProposalSection["status"] = "missing";
      let source: ProposalSection["source"] = "manual";

      if (match.status === "matched" && match.libraryContent) {
        content = match.libraryContent.content;
        status = "generated";
        source = "library";
      } else if (match.status === "partial" && match.libraryContent) {
        content = `${match.libraryContent.content}\n\n⚠️ 此内容置信度较低（${Math.round(match.confidence * 100)}%），建议使用AI优化或人工审核。`;
        status = "generated";
        source = "library";
      }

      return {
        id: match.requirementId,
        sectionId: match.requirementId,
        title: match.requirementTitle,
        content,
        status,
        source,
        isEditing: false,
      };
    });

    setSections(newSections);
  };

  const handleEdit = (id: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, isEditing: true } : s
    ));
  };

  const handleSave = (id: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, isEditing: false, status: "edited" as const } : s
    ));
    toast.success("内容已保存");
  };

  const handleCancel = (id: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, isEditing: false } : s
    ));
  };

  const handleContentChange = (id: string, content: string) => {
    setSections(sections.map(s => 
      s.id === id ? { ...s, content } : s
    ));
  };

  const handleCopy = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("已复制到剪贴板");
  };

  const handleAIGenerate = async (id: string) => {
    const section = sections.find(s => s.id === id);
    const requirement = requirements.find(r => r.id === id);
    
    if (!section || !requirement) return;

    if (!aiConfig.enabled) {
      toast.error("请先配置AI助手");
      return;
    }

    setIsGenerating(true);
    
    try {
      // 构建上下文
      const context = `招标要求：${requirement.description}\n章节标题：${section.title}`;
      const prompt = `请根据以下招标要求，生成投标书中"${section.title}"章节的内容：\n\n${requirement.description}\n\n要求：内容应专业、详细、符合招标要求，字数在300-500字之间。`;
      
      const generatedContent = await onGenerateWithAI(id, context);
      
      setSections(sections.map(s => 
        s.id === id ? {
          ...s,
          content: generatedContent,
          status: "ai-generated" as const,
          source: "ai" as const,
        } : s
      ));
      
      toast.success("AI生成完成");
    } catch (error) {
      toast.error("AI生成失败：" + (error as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExport = () => {
    // 生成完整的投标书内容
    const parts = BID_STRUCTURE;
    let exportContent = "投标书\n\n";
    exportContent += `生成时间：${new Date().toLocaleString()}\n`;
    exportContent += "=" .repeat(60) + "\n\n";

    sections.forEach((section, index) => {
      exportContent += `${index + 1}. ${section.title}\n`;
      exportContent += "-".repeat(60) + "\n";
      exportContent += section.content || "【待补充】\n";
      exportContent += "\n\n";
    });

    const blob = new Blob([exportContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `投标书_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast.success("投标书已导出");
    onExport();
  };

  const getFilteredSections = () => {
    switch (activeTab) {
      case "completed":
        return sections.filter(s => s.content && s.content.trim().length > 0);
      case "missing":
        return sections.filter(s => !s.content || s.content.trim().length === 0);
      case "ai":
        return sections.filter(s => s.source === "ai");
      default:
        return sections;
    }
  };

  const getStatistics = () => {
    const total = sections.length;
    const completed = sections.filter(s => s.content && s.content.trim().length > 0).length;
    const missing = total - completed;
    const aiGenerated = sections.filter(s => s.source === "ai").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, missing, aiGenerated, completionRate };
  };

  const stats = getStatistics();
  const filteredSections = getFilteredSections();

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">投标书编辑器</h3>
            <p className="text-sm text-muted-foreground mt-1">
              共 {stats.total} 个章节，已完成 {stats.completed} 个
            </p>
          </div>
          <Button onClick={handleExport} className="gap-2">
            <FileDown className="h-4 w-4" />
            导出投标书
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="p-4 bg-muted/30 rounded-lg text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">总章节</p>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.completed}
            </p>
            <p className="text-sm text-muted-foreground">已完成</p>
          </div>
          <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg text-center">
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {stats.missing}
            </p>
            <p className="text-sm text-muted-foreground">待补充</p>
          </div>
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {stats.aiGenerated}
            </p>
            <p className="text-sm text-muted-foreground">AI生成</p>
          </div>
        </div>

        {stats.missing > 0 && (
          <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/30">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <AlertDescription className="text-orange-700 dark:text-orange-300">
              还有 {stats.missing} 个章节需要补充内容
            </AlertDescription>
          </Alert>
        )}
      </Card>

      <Card className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="all">
              全部 ({sections.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              已完成 ({stats.completed})
            </TabsTrigger>
            <TabsTrigger value="missing">
              待补充 ({stats.missing})
            </TabsTrigger>
            <TabsTrigger value="ai">
              AI生成 ({stats.aiGenerated})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab}>
            <ScrollArea className="h-[700px]">
              <div className="space-y-6 pr-4">
                {filteredSections.map((section, index) => (
                  <div key={section.id} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between p-4 bg-muted/30">
                      <div className="flex items-center gap-3 flex-1">
                        <Badge variant="outline">{index + 1}</Badge>
                        <h4 className="font-medium">{section.title}</h4>
                        {section.source === "ai" && (
                          <Badge variant="secondary" className="gap-1">
                            <Sparkles className="h-3 w-3" />
                            AI
                          </Badge>
                        )}
                        {section.status === "edited" && (
                          <Badge variant="secondary">已编辑</Badge>
                        )}
                        {(!section.content || section.content.trim().length === 0) && (
                          <Badge variant="destructive">待补充</Badge>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        {section.content && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(section.content, section.id)}
                          >
                            {copiedId === section.id ? (
                              <CheckCircle className="h-4 w-4" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        
                        {!section.isEditing && aiConfig.enabled && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAIGenerate(section.id)}
                            disabled={isGenerating}
                            className="gap-1"
                          >
                            <Sparkles className="h-4 w-4" />
                            {section.content ? "重新生成" : "AI生成"}
                          </Button>
                        )}
                        
                        {!section.isEditing ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(section.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        ) : (
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancel(section.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSave(section.id)}
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-4">
                      {section.isEditing ? (
                        <Textarea
                          value={section.content}
                          onChange={(e) => handleContentChange(section.id, e.target.value)}
                          className="min-h-[300px] font-mono text-sm"
                          placeholder="请输入内容..."
                        />
                      ) : section.content ? (
                        <div className="prose prose-sm max-w-none">
                          <p className="whitespace-pre-wrap text-sm">
                            {section.content}
                          </p>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-muted-foreground">
                          <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>此章节内容缺失</p>
                          <p className="text-sm mt-1">
                            {aiConfig.enabled
                              ? "点击上方"AI生成"按钮自动生成内容"
                              : "请手动填写或配置AI助手"}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
