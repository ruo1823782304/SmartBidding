import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { CheckCircle, XCircle, AlertTriangle, Sparkles } from "lucide-react";
import { BidLibraryItem } from "./BidLibraryManager";
import { TenderRequirement } from "./TenderAnalyzer";
import { Progress } from "./ui/progress";

export interface MatchedContent {
  requirementId: string;
  requirementTitle: string;
  status: "matched" | "missing" | "partial";
  libraryContent?: BidLibraryItem;
  confidence: number;
  needsAI?: boolean;
}

interface ContentMatcherProps {
  requirements: TenderRequirement[];
  library: BidLibraryItem[];
  onMatchComplete: (matches: MatchedContent[]) => void;
}

export function ContentMatcher({ requirements, library, onMatchComplete }: ContentMatcherProps) {
  const [matches, setMatches] = React.useState<MatchedContent[]>([]);
  const [isMatching, setIsMatching] = React.useState(false);

  React.useEffect(() => {
    performMatching();
  }, [requirements, library]);

  const performMatching = async () => {
    setIsMatching(true);

    await new Promise(resolve => setTimeout(resolve, 1500));

    // 执行内容匹配
    const matchResults: MatchedContent[] = requirements.map(req => {
      // 查找标书库中对应章节的内容
      const libraryItem = library.find(item => item.sectionId === req.sectionId);

      if (libraryItem) {
        // 计算匹配置信度（这里使用模拟算法）
        const confidence = calculateConfidence(req, libraryItem);
        
        if (confidence > 0.7) {
          return {
            requirementId: req.id,
            requirementTitle: req.title,
            status: "matched" as const,
            libraryContent: libraryItem,
            confidence,
            needsAI: false,
          };
        } else {
          return {
            requirementId: req.id,
            requirementTitle: req.title,
            status: "partial" as const,
            libraryContent: libraryItem,
            confidence,
            needsAI: true,
          };
        }
      } else {
        // 标书库中没有对应内容
        return {
          requirementId: req.id,
          requirementTitle: req.title,
          status: "missing" as const,
          confidence: 0,
          needsAI: true,
        };
      }
    });

    setMatches(matchResults);
    onMatchComplete(matchResults);
    setIsMatching(false);
  };

  const calculateConfidence = (req: TenderRequirement, item: BidLibraryItem): number => {
    // 简单的模拟匹配算法
    // 实际应用中可以使用更复杂的文本相似度算法
    const titleMatch = req.title.toLowerCase().includes(item.sectionTitle.toLowerCase()) ||
                       item.sectionTitle.toLowerCase().includes(req.title.toLowerCase());
    
    if (titleMatch) {
      return 0.85 + Math.random() * 0.15; // 0.85-1.0
    }
    
    // 基于内容关键词匹配
    const keywords = extractKeywords(req.description);
    const contentKeywords = extractKeywords(item.content);
    const overlap = keywords.filter(k => contentKeywords.includes(k)).length;
    
    return Math.min(0.5 + (overlap / keywords.length) * 0.4, 0.9);
  };

  const extractKeywords = (text: string): string[] => {
    // 简单的关键词提取
    return text.split(/\s+/).filter(word => word.length > 2);
  };

  const getStatistics = () => {
    const total = matches.length;
    const matched = matches.filter(m => m.status === "matched").length;
    const partial = matches.filter(m => m.status === "partial").length;
    const missing = matches.filter(m => m.status === "missing").length;
    const needsAI = matches.filter(m => m.needsAI).length;
    const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;

    return { total, matched, partial, missing, needsAI, matchRate };
  };

  const stats = getStatistics();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "matched":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "partial":
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case "missing":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "matched":
        return <Badge className="bg-green-500">已匹配</Badge>;
      case "partial":
        return <Badge className="bg-orange-500">部分匹配</Badge>;
      case "missing":
        return <Badge variant="destructive">未找到</Badge>;
      default:
        return null;
    }
  };

  if (isMatching) {
    return (
      <Card className="p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mb-4"></div>
          <p className="text-lg font-medium">正在匹配标书库内容...</p>
          <p className="text-sm text-muted-foreground mt-2">
            分析招标要求并检索标书库
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h3 className="font-semibold mb-4">匹配分析结果</h3>
        
        <div className="space-y-4 mb-6">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">整体匹配度</span>
              <span className="font-bold text-lg">{stats.matchRate}%</span>
            </div>
            <Progress value={stats.matchRate} className="h-3" />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {stats.matched}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">完全匹配</p>
            </div>
            
            <div className="p-4 bg-orange-50 dark:bg-orange-950/30 rounded-lg text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {stats.partial}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">部分匹配</p>
            </div>
            
            <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {stats.missing}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">缺失内容</p>
            </div>
            
            <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-blue-500" />
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {stats.needsAI}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">需AI生成</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-4">详细匹配结果</h3>
        <ScrollArea className="h-[600px]">
          <div className="space-y-4">
            {matches.map((match) => {
              const requirement = requirements.find(r => r.id === match.requirementId);
              
              return (
                <div
                  key={match.requirementId}
                  className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {getStatusIcon(match.status)}
                    <div className="flex-1 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium mb-1">{match.requirementTitle}</h4>
                          {requirement && (
                            <p className="text-sm text-muted-foreground">
                              {requirement.description}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0 ml-4">
                          {getStatusBadge(match.status)}
                          {match.needsAI && (
                            <Badge variant="outline" className="gap-1">
                              <Sparkles className="h-3 w-3" />
                              需AI
                            </Badge>
                          )}
                        </div>
                      </div>

                      {match.libraryContent && (
                        <div className="p-3 bg-muted/50 rounded">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium">标书库匹配内容</p>
                            <Badge variant="secondary">
                              置信度 {Math.round(match.confidence * 100)}%
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {match.libraryContent.content}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            来源：{match.libraryContent.sourceFile}
                          </p>
                        </div>
                      )}

                      {match.status === "missing" && (
                        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded border border-red-200 dark:border-red-900">
                          <p className="text-sm text-red-700 dark:text-red-300">
                            ⚠️ 标书库中未找到相关内容，建议使用AI生成或手动填写
                          </p>
                        </div>
                      )}

                      {match.status === "partial" && (
                        <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded border border-orange-200 dark:border-orange-900">
                          <p className="text-sm text-orange-700 dark:text-orange-300">
                            ⚠️ 匹配置信度较低，建议使用AI优化或人工审核
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
