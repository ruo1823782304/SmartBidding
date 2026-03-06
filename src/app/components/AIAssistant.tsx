import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Sparkles, Settings, CheckCircle, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";

export interface AIConfig {
  model: string;
  enabled: boolean;
}

interface AIAssistantProps {
  config: AIConfig;
  onConfigChange: (config: AIConfig) => void;
  onGenerate: (prompt: string, context: string) => Promise<string>;
}

export function AIAssistant({ config, onConfigChange, onGenerate }: AIAssistantProps) {
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [testPrompt, setTestPrompt] = useState("");
  const [testResult, setTestResult] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [hasServerApiKey, setHasServerApiKey] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const resp = await fetch("/api/admin/config");
        const json = await resp.json();
        if (json?.success) {
          setHasServerApiKey(json.data?.hasApiKey ?? false);
          onConfigChange({
            ...config,
            model: json.data?.model || config.model,
            enabled: json.data?.hasApiKey ?? false,
          });
        }
      } catch {
        setHasServerApiKey(false);
      }
    };
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfigSave = async (apiKey: string, model: string) => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey: apiKey, openaiModel: model }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.success) {
        throw new Error(json?.message || "保存配置失败");
      }
      setHasServerApiKey(true);
      onConfigChange({
        ...config,
        model,
        enabled: true,
      });
      setIsConfigOpen(false);
    } catch (err) {
      setTestResult("保存配置失败：" + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testPrompt.trim()) return;

    setIsTesting(true);
    try {
      const result = await onGenerate(testPrompt, "测试上下文");
      setTestResult(result);
    } catch (error) {
      setTestResult("测试失败：" + (error as Error).message);
    }
    setIsTesting(false);
  };

  const enabled = !!config.enabled && !!hasServerApiKey;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-blue-500" />
          <div>
            <h3 className="font-semibold">AI助手</h3>
            <p className="text-sm text-muted-foreground">
              自动生成缺失的标书内容（使用后端统一配置的 OpenAI Key）
            </p>
          </div>
        </div>
        <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings className="h-4 w-4" />
              配置
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>AI统一配置</DialogTitle>
              <DialogDescription>
                在这里配置一次 OpenAI API Key 和模型，整个平台所有人共用。
              </DialogDescription>
            </DialogHeader>
            <AIConfigForm
              model={config.model}
              saving={saving}
              onSave={(data) => handleConfigSave(data.apiKey, data.model)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {enabled ? (
          <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30">
            <CheckCircle className="h-4 w-4 text-blue-500" />
            <AlertDescription className="text-blue-700 dark:text-blue-300">
              AI助手已启用（使用服务器上配置的 API Key），将自动生成缺失和低置信度内容
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/30">
            <XCircle className="h-4 w-4 text-orange-500" />
            <AlertDescription className="text-orange-700 dark:text-orange-300">
              AI助手未启用，请先在本页点击“配置”，填写服务器统一使用的 OpenAI API Key
            </AlertDescription>
          </Alert>
        )}

        {enabled && (
          <div className="p-4 bg-muted/30 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">模型：</span>
                <span className="font-medium ml-2">{config.model || "未配置"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">状态：</span>
                <Badge variant="secondary" className="ml-2">
                  就绪
                </Badge>
              </div>
            </div>

            <div className="pt-3 border-t space-y-2">
              <Label>测试AI生成</Label>
              <Textarea
                placeholder="输入测试提示词，例如：生成一份项目背景理解..."
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="min-h-[80px]"
              />
              <Button
                onClick={handleTest}
                disabled={isTesting || !testPrompt.trim()}
                size="sm"
                className="w-full"
              >
                {isTesting ? "生成中..." : "测试生成"}
              </Button>

              {testResult && (
                <div className="p-3 bg-background rounded border mt-2">
                  <p className="text-sm whitespace-pre-wrap">{testResult}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <p>💡 提示：</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>API Key 只保存在服务器 `data/config.json` 中，不会下发到浏览器。</li>
            <li>所有访问 `198.130.0.0` 这个应用的同事都会共用这套配置。</li>
            <li>生成的内容需要人工审核和调整。</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function AIConfigForm({
  model,
  saving,
  onSave,
}: {
  model: string;
  saving: boolean;
  onSave: (data: { apiKey: string; model: string }) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [modelInput, setModelInput] = useState(model || "gpt-4o");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ apiKey, model: modelInput });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="api-key">OpenAI API Key</Label>
        <Input
          id="api-key"
          type="password"
          placeholder="sk-..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          仅保存到服务器本地配置（data/config.json），不会存到浏览器或前端代码。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">模型名称</Label>
        <Input
          id="model"
          placeholder="gpt-4o"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="submit" disabled={saving}>
          {saving ? "保存中..." : "保存配置"}
        </Button>
      </div>
    </form>
  );
}
