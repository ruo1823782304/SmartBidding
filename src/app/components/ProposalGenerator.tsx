import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { FileDown, Sparkles, Copy, CheckCircle } from "lucide-react";
import { Alert, AlertDescription } from "./ui/alert";

interface GeneratedSection {
  title: string;
  content: string;
  isEditable: boolean;
}

interface UsedSectionInfo {
  sectionKey: string;
  sectionTitle: string;
  exampleCount: number;
}

interface ProposalGeneratorProps {
  sections: GeneratedSection[];
  onSectionEdit: (index: number, content: string) => void;
  onExport: () => void;
  /** 后端生成标书时返回的“本次复用的历史小节”信息，可选 */
  usedSections?: UsedSectionInfo[];
}

export function ProposalGenerator({
  sections,
  onSectionEdit,
  onExport,
  usedSections,
}: ProposalGeneratorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleEdit = (index: number) => {
    setEditingIndex(index);
  };

  const handleSave = () => {
    setEditingIndex(null);
  };

  const handleCopy = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-4">
      {usedSections && usedSections.length > 0 && (
        <Card className="p-4 border-green-200 bg-green-50 dark:bg-green-950/30">
          <h3 className="font-semibold mb-1">本次复用的历史表达小节</h3>
          <p className="text-xs text-muted-foreground mb-2">
            后端根据您的标书库片段，在本次生成中复用了 {usedSections.length} 个小节的典型表达（可在下方章节内容中再做细节调整）。
          </p>
          <div className="flex flex-wrap gap-2">
            {usedSections.slice(0, 12).map((s) => (
              <Badge key={s.sectionKey} variant="secondary" className="text-xs">
                {s.sectionTitle} · {s.exampleCount}条
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <Alert>
        <Sparkles className="h-4 w-4" />
        <AlertDescription>
          基于招标书要求和您的投标书模板，已自动生成新的投标书内容。您可以编辑任何章节，点击导出按钮下载完整文档。
        </AlertDescription>
      </Alert>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">生成的投标书</h3>
            <p className="text-sm text-muted-foreground mt-1">
              共 {sections.length} 个章节
            </p>
          </div>
          <Button onClick={onExport} className="gap-2">
            <FileDown className="h-4 w-4" />
            导出投标书
          </Button>
        </div>

        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-6">
            {sections.map((section, index) => (
              <div key={index} className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-4 bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{index + 1}</Badge>
                    <h4 className="font-medium">{section.title}</h4>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(section.content, index)}
                    >
                      {copiedIndex === index ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    {section.isEditable && editingIndex !== index && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(index)}
                      >
                        编辑
                      </Button>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  {editingIndex === index ? (
                    <div className="space-y-2">
                      <Textarea
                        value={section.content}
                        onChange={(e) => onSectionEdit(index, e.target.value)}
                        className="min-h-[200px] font-mono text-sm"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingIndex(null)}
                        >
                          取消
                        </Button>
                        <Button size="sm" onClick={handleSave}>
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      <p className="whitespace-pre-wrap text-sm">
                        {section.content}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
