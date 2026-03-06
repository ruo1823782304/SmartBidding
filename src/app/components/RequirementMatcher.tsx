import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";

interface MatchResult {
  requirement: string;
  status: "matched" | "partial" | "missing";
  bidContent?: string;
  suggestion?: string;
}

interface RequirementMatcherProps {
  results: MatchResult[];
  matchScore: number;
}

export function RequirementMatcher({ results, matchScore }: RequirementMatcherProps) {
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
        return <Badge variant="destructive">缺失</Badge>;
      default:
        return null;
    }
  };

  const matched = results.filter((r) => r.status === "matched").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const missing = results.filter((r) => r.status === "missing").length;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold mb-4">匹配度分析</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">整体匹配度</span>
              <span className="font-bold text-lg">{matchScore}%</span>
            </div>
            <Progress value={matchScore} className="h-3" />
          </div>

          <div className="grid grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-2xl font-bold">{matched}</span>
              </div>
              <p className="text-sm text-muted-foreground">已匹配</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span className="text-2xl font-bold">{partial}</span>
              </div>
              <p className="text-sm text-muted-foreground">部分匹配</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-2xl font-bold">{missing}</span>
              </div>
              <p className="text-sm text-muted-foreground">缺失</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold mb-4">详细匹配结果</h3>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {results.map((result, index) => (
              <div
                key={index}
                className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {getStatusIcon(result.status)}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between">
                      <h4 className="font-medium">{result.requirement}</h4>
                      {getStatusBadge(result.status)}
                    </div>

                    {result.bidContent && (
                      <div className="p-3 bg-muted/50 rounded">
                        <p className="text-sm font-medium mb-1">投标书内容</p>
                        <p className="text-sm text-muted-foreground">
                          {result.bidContent}
                        </p>
                      </div>
                    )}

                    {result.suggestion && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-900">
                        <p className="text-sm font-medium mb-1 text-blue-700 dark:text-blue-300">
                          建议
                        </p>
                        <p className="text-sm text-blue-600 dark:text-blue-400">
                          {result.suggestion}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
