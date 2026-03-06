import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { CheckCircle2, AlertCircle, FileText, Calendar, DollarSign } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";

interface AnalysisData {
  fileName: string;
  type: "bid" | "tender";
  sections: {
    title: string;
    content: string;
    importance: "high" | "medium" | "low";
  }[];
  metadata: {
    projectName?: string;
    deadline?: string;
    budget?: string;
    location?: string;
  };
  keywords: string[];
}

interface DocumentAnalysisProps {
  data: AnalysisData;
}

export function DocumentAnalysis({ data }: DocumentAnalysisProps) {
  const isBid = data.type === "bid";

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            <div>
              <h3 className="font-semibold">{data.fileName}</h3>
              <Badge variant={isBid ? "default" : "secondary"}>
                {isBid ? "投标书" : "招标书"}
              </Badge>
            </div>
          </div>
          <Badge variant="outline" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            分析完成
          </Badge>
        </div>

        {/* 项目元数据 */}
        {Object.keys(data.metadata).length > 0 && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg mb-4">
            {data.metadata.projectName && (
              <div>
                <p className="text-sm text-muted-foreground">项目名称</p>
                <p className="font-medium">{data.metadata.projectName}</p>
              </div>
            )}
            {data.metadata.deadline && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">截止日期</p>
                  <p className="font-medium">{data.metadata.deadline}</p>
                </div>
              </div>
            )}
            {data.metadata.budget && (
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">预算范围</p>
                  <p className="font-medium">{data.metadata.budget}</p>
                </div>
              </div>
            )}
            {data.metadata.location && (
              <div>
                <p className="text-sm text-muted-foreground">项目地点</p>
                <p className="font-medium">{data.metadata.location}</p>
              </div>
            )}
          </div>
        )}

        {/* 关键词 */}
        {data.keywords.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2">关键词</h4>
            <div className="flex flex-wrap gap-2">
              {data.keywords.map((keyword, index) => (
                <Badge key={index} variant="secondary">
                  {keyword}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 文档章节分析 */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">文档内容分析</h3>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {data.sections.map((section, index) => (
              <div
                key={index}
                className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2">
                    {section.title}
                    {section.importance === "high" && (
                      <AlertCircle className="h-4 w-4 text-orange-500" />
                    )}
                  </h4>
                  <Badge
                    variant={
                      section.importance === "high"
                        ? "destructive"
                        : section.importance === "medium"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {section.importance === "high"
                      ? "重要"
                      : section.importance === "medium"
                      ? "中等"
                      : "一般"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {section.content}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
