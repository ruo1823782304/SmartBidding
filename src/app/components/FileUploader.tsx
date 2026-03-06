import { Upload, FileText, X } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { useState } from "react";

interface FileUploaderProps {
  onFileUpload: (file: File, content: string) => void;
  title: string;
  description: string;
  accept?: string;
}

export function FileUploader({ onFileUpload, title, description, accept = ".pdf,.doc,.docx,.txt" }: FileUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    setUploadedFile(file);
    // 模拟文件读取
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      // 模拟文档内容（实际应用中需要真实的文档解析）
      const mockContent = generateMockContent(file.name);
      onFileUpload(file, mockContent);
    };
    reader.readAsText(file);
  };

  const generateMockContent = (fileName: string) => {
    // 生成模拟的文档内容用于演示
    return `文档名称: ${fileName}\n解析时间: ${new Date().toLocaleString()}\n文档内容已成功读取`;
  };

  const removeFile = () => {
    setUploadedFile(null);
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {!uploadedFile ? (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="mb-2">拖拽文件到此处，或点击上传</p>
            <p className="text-sm text-muted-foreground mb-4">
              支持格式: PDF, Word, TXT
            </p>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              onChange={handleChange}
              accept={accept}
            />
            <label htmlFor="file-upload">
              <Button asChild>
                <span>选择文件</span>
              </Button>
            </label>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">{uploadedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(uploadedFile.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={removeFile}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
