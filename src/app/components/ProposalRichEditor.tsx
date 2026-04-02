import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import FontFamily from "@tiptap/extension-font-family";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Brush,
  Eraser,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";

type ProposalRichEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

type CopiedFormat = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
  fontFamily?: string;
  fontSize?: string;
  align?: "left" | "center" | "right" | "justify";
};

type FormatPainterMode = "idle" | "single" | "locked";

const FONT_OPTIONS = ["宋体", "仿宋", "黑体", "楷体", "Arial"];
const FONT_SIZE_OPTIONS = [
  { label: "五号", value: "10.5pt" },
  { label: "小四", value: "12pt" },
  { label: "四号", value: "14pt" },
  { label: "小三", value: "15pt" },
  { label: "三号", value: "16pt" },
];

function editorButtonClass(active = false) {
  return active
    ? "h-8 rounded border border-[#165DFF] bg-[#EEF4FF] px-2 text-[#165DFF]"
    : "h-8 rounded border border-[#E4E7ED] bg-white px-2 text-[#606266] hover:bg-[#F5F7FA]";
}

function appendHtmlBlock(source: string, html: string) {
  if (!source.trim()) {
    return html;
  }
  return `${source}${html}`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToHtml(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line || " ")}</p>`)
    .join("");
}

const MAX_EDITOR_IMAGE_EDGE = 1600;
const MAX_ORIGINAL_IMAGE_BYTES = 1.5 * 1024 * 1024;
const JPEG_EXPORT_QUALITY = 0.82;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败，请重新选择后再试"));
    image.src = dataUrl;
  });
}

function hasTransparentPixel(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const { data } = context.getImageData(0, 0, width, height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) {
      return true;
    }
  }
  return false;
}

async function buildOptimizedEditorImage(file: File) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(originalDataUrl);
  const scale = Math.min(1, MAX_EDITOR_IMAGE_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const targetWidth = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const targetHeight = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const shouldKeepOriginal =
    scale === 1 &&
    file.size <= MAX_ORIGINAL_IMAGE_BYTES &&
    /^image\/(png|jpeg|jpg|gif|bmp)$/i.test(file.type);

  if (shouldKeepOriginal) {
    return {
      dataUrl: originalDataUrl,
      optimized: false,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return {
      dataUrl: originalDataUrl,
      optimized: false,
    };
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const keepTransparency = file.type === "image/png" && hasTransparentPixel(context, targetWidth, targetHeight);
  const outputType = keepTransparency ? "image/png" : "image/jpeg";
  const optimizedDataUrl = canvas.toDataURL(
    outputType,
    outputType === "image/jpeg" ? JPEG_EXPORT_QUALITY : undefined,
  );

  return {
    dataUrl: optimizedDataUrl.length < originalDataUrl.length ? optimizedDataUrl : originalDataUrl,
    optimized: scale < 1 || optimizedDataUrl.length < originalDataUrl.length,
  };
}

async function collectClipboardImageDataUrls(dataTransfer: DataTransfer) {
  const fromItems = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const fromFiles = Array.from(dataTransfer.files ?? []).filter((file) => file.type.startsWith("image/"));
  const merged = [...fromItems];

  fromFiles.forEach((file) => {
    const exists = merged.some(
      (current) =>
        current.name === file.name &&
        current.size === file.size &&
        current.type === file.type &&
        current.lastModified === file.lastModified,
    );
    if (!exists) {
      merged.push(file);
    }
  });

  const prepared = await Promise.all(merged.map((file) => buildOptimizedEditorImage(file)));
  return prepared.map((item) => item.dataUrl);
}

function shouldReplaceClipboardImageSrc(src: string) {
  if (!src.trim()) {
    return true;
  }

  return /^(file:|cid:|blob:)/i.test(src.trim());
}

function normalizePastedHtml(html: string, imageDataUrls: string[]) {
  const parser = new window.DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const body = document.body;

  body.querySelectorAll("meta,link,style,script,title,xml").forEach((node) => node.remove());

  let imageIndex = 0;
  body.querySelectorAll("img").forEach((image) => {
    const currentSrc = image.getAttribute("src") || "";
    if (currentSrc.startsWith("data:image/")) {
      return;
    }

    if (shouldReplaceClipboardImageSrc(currentSrc)) {
      const replacement = imageDataUrls[imageIndex];
      if (!replacement) {
        image.remove();
        return;
      }

      image.setAttribute("src", replacement);
      imageIndex += 1;
      return;
    }

    if (/^https?:/i.test(currentSrc)) {
      return;
    }

    const replacement = imageDataUrls[imageIndex];
    if (!replacement) {
      image.remove();
      return;
    }

    image.setAttribute("src", replacement);
    imageIndex += 1;
  });

  if (imageIndex < imageDataUrls.length) {
    imageDataUrls.slice(imageIndex).forEach((src) => {
      const paragraph = document.createElement("p");
      const image = document.createElement("img");
      image.setAttribute("src", src);
      paragraph.appendChild(image);
      body.appendChild(paragraph);
    });
  }

  return body.innerHTML.trim();
}

function selectCurrentTextBlock(editor: TiptapEditor) {
  const { state, view } = editor;
  const { $from } = state.selection;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (!node.isTextblock) {
      continue;
    }

    const start = $from.start(depth);
    const end = $from.end(depth);
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
    return;
  }
}

function applyCopiedFormat(editor: TiptapEditor, format: CopiedFormat) {
  let chain = editor.chain().focus();

  chain = format.bold ? chain.setMark("bold") : chain.unsetMark("bold");
  chain = format.italic ? chain.setMark("italic") : chain.unsetMark("italic");
  chain = format.underline ? chain.setMark("underline") : chain.unsetMark("underline");
  chain = format.strike ? chain.setMark("strike") : chain.unsetMark("strike");

  chain = format.color ? chain.setColor(format.color) : chain.unsetColor();
  chain = format.fontFamily ? chain.setFontFamily(format.fontFamily) : chain.unsetFontFamily();
  chain = format.fontSize ? chain.setFontSize(format.fontSize) : chain.unsetFontSize();
  chain = chain.setTextAlign(format.align ?? "left");

  chain.run();
}

export function ProposalRichEditor({ value, onChange, placeholder }: ProposalRichEditorProps) {
  const [copiedFormat, setCopiedFormat] = useState<CopiedFormat | null>(null);
  const [formatPainterMode, setFormatPainterMode] = useState<FormatPainterMode>("idle");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const formatPainterClickTimerRef = useRef<number | null>(null);
  const formatPainterRef = useRef<{ mode: FormatPainterMode; copiedFormat: CopiedFormat | null }>({
    mode: "idle",
    copiedFormat: null,
  });
  const applyingFormatRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      TextAlign.configure({
        types: ["paragraph"],
      }),
      Placeholder.configure({
        placeholder: placeholder || "开始编写当前章节内容...",
      }),
    ],
    content: value || "<p></p>",
    onUpdate({ editor: currentEditor }) {
      onChange(currentEditor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[420px] rounded-b-[8px] border-x border-b border-[#E4E7ED] bg-white px-5 py-4 outline-none proposal-rich-editor",
      },
      handlePaste(_view, event) {
        const clipboardData = event.clipboardData;
        if (!clipboardData || !editor) {
          return false;
        }

        const html = clipboardData.getData("text/html");
        const plainText = clipboardData.getData("text/plain");
        const hasClipboardImage =
          Array.from(clipboardData.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/")) ||
          Array.from(clipboardData.files ?? []).some((file) => file.type.startsWith("image/"));
        const needsCustomPaste =
          hasClipboardImage ||
          /<img[\s\S]*?(file:|cid:|blob:)/i.test(html) ||
          /<v:imagedata/i.test(html);

        if (!needsCustomPaste) {
          return false;
        }

        event.preventDefault();

        void (async () => {
          try {
            const imageDataUrls = await collectClipboardImageDataUrls(clipboardData);
            const normalizedHtml = html.trim()
              ? normalizePastedHtml(html, imageDataUrls)
              : [
                  plainText.trim() ? plainTextToHtml(plainText) : "",
                  ...imageDataUrls.map((src) => `<p><img src="${src}" /></p>`),
                ]
                  .filter(Boolean)
                  .join("");

            if (!normalizedHtml.trim()) {
              if (plainText.trim()) {
                editor.chain().focus().insertContent(plainTextToHtml(plainText)).run();
              }
              return;
            }

            editor.chain().focus().insertContent(normalizedHtml).run();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "粘贴失败，请重试");
          }
        })();

        return true;
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const currentHtml = editor.getHTML();
    if (value !== currentHtml) {
      editor.commands.setContent(value || "<p></p>", false);
    }
  }, [editor, value]);

  const currentTextStyle = editor?.getAttributes("textStyle") as {
    color?: string;
    fontFamily?: string;
    fontSize?: string;
  } | undefined;

  const currentAlign =
    editor?.isActive({ textAlign: "center" })
      ? "center"
      : editor?.isActive({ textAlign: "right" })
        ? "right"
        : editor?.isActive({ textAlign: "justify" })
          ? "justify"
          : "left";

  useEffect(() => {
    formatPainterRef.current = {
      mode: formatPainterMode,
      copiedFormat,
    };
  }, [copiedFormat, formatPainterMode]);

  useEffect(() => {
    return () => {
      if (formatPainterClickTimerRef.current) {
        window.clearTimeout(formatPainterClickTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handleMouseUp = () => {
      const painterState = formatPainterRef.current;
      if (painterState.mode === "idle" || !painterState.copiedFormat || applyingFormatRef.current) {
        return;
      }

      window.requestAnimationFrame(() => {
        const latestPainterState = formatPainterRef.current;
        if (latestPainterState.mode === "idle" || !latestPainterState.copiedFormat || applyingFormatRef.current) {
          return;
        }

        applyingFormatRef.current = true;
        try {
          if (editor.state.selection.empty) {
            selectCurrentTextBlock(editor);
          }
          applyCopiedFormat(editor, latestPainterState.copiedFormat);
          if (latestPainterState.mode === "single") {
            setFormatPainterMode("idle");
          }
        } finally {
          applyingFormatRef.current = false;
        }
      });
    };

    const dom = editor.view.dom;
    dom.addEventListener("mouseup", handleMouseUp);
    return () => {
      dom.removeEventListener("mouseup", handleMouseUp);
    };
  }, [editor]);

  const captureCurrentFormat = () => {
    if (!editor) {
      return null;
    }

    return {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      color: currentTextStyle?.color,
      fontFamily: currentTextStyle?.fontFamily,
      fontSize: currentTextStyle?.fontSize,
      align: currentAlign,
    } satisfies CopiedFormat;
  };

  const activateFormatPainter = (mode: Exclude<FormatPainterMode, "idle">) => {
    const nextFormat = captureCurrentFormat();
    if (!nextFormat) {
      return;
    }

    setCopiedFormat(nextFormat);
    setFormatPainterMode(mode);
    toast.success(
      mode === "locked"
        ? "连续格式刷已开启，点击目标行即可持续套用格式"
        : "格式刷已开启，点击目标行即可套用一次",
    );
  };

  const handleFormatPainterClick = () => {
    if (formatPainterClickTimerRef.current) {
      window.clearTimeout(formatPainterClickTimerRef.current);
    }

    formatPainterClickTimerRef.current = window.setTimeout(() => {
      formatPainterClickTimerRef.current = null;

      if (formatPainterRef.current.mode !== "idle") {
        setFormatPainterMode("idle");
        toast.success("格式刷已关闭");
        return;
      }

      activateFormatPainter("single");
    }, 220);
  };

  const handleFormatPainterDoubleClick = () => {
    if (formatPainterClickTimerRef.current) {
      window.clearTimeout(formatPainterClickTimerRef.current);
      formatPainterClickTimerRef.current = null;
    }

    if (formatPainterRef.current.mode === "locked") {
      setFormatPainterMode("idle");
      toast.success("连续格式刷已关闭");
      return;
    }

    activateFormatPainter("locked");
  };

  const handleInsertImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !editor) {
      return;
    }

    try {
      const { dataUrl, optimized } = await buildOptimizedEditorImage(file);
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
      if (optimized) {
        toast.success("图片已自动压缩，保存和导出会更稳定");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片插入失败");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="overflow-hidden rounded-[10px]">
      <style>
        {`
          .proposal-rich-editor p {
            margin: 0 0 12px;
            line-height: 1.7;
          }
          .proposal-rich-editor ul,
          .proposal-rich-editor ol {
            margin: 0 0 12px;
            padding-left: 24px;
          }
          .proposal-rich-editor img {
            display: block;
            max-width: 100%;
            height: auto;
            margin: 12px 0;
          }
        `}
      </style>
      <div className="flex flex-wrap items-center gap-2 rounded-t-[8px] border border-[#E4E7ED] bg-[#F8FAFC] px-3 py-3">
        <button
          type="button"
          className={editorButtonClass(editor?.isActive("bold"))}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(editor?.isActive("italic"))}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(editor?.isActive("underline"))}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(editor?.isActive("strike"))}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-4 w-4" />
        </button>

        <select
          className="h-8 rounded border border-[#E4E7ED] bg-white px-2 text-sm"
          value={currentTextStyle?.fontFamily || "宋体"}
          onChange={(event) => editor?.chain().focus().setFontFamily(event.target.value).run()}
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>

        <select
          className="h-8 rounded border border-[#E4E7ED] bg-white px-2 text-sm"
          value={currentTextStyle?.fontSize || "10.5pt"}
          onChange={(event) => editor?.chain().focus().setFontSize(event.target.value).run()}
        >
          {FONT_SIZE_OPTIONS.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>

        <input
          type="color"
          className="h-8 w-10 cursor-pointer rounded border border-[#E4E7ED] bg-white p-1"
          value={(currentTextStyle?.color as string) || "#000000"}
          onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
        />

        <button
          type="button"
          className={editorButtonClass(editor?.isActive("bulletList"))}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(editor?.isActive("orderedList"))}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </button>

        <button
          type="button"
          className={editorButtonClass(currentAlign === "left")}
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(currentAlign === "center")}
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(currentAlign === "right")}
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(currentAlign === "justify")}
          onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
        >
          <AlignJustify className="h-4 w-4" />
        </button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-8 ${formatPainterMode === "idle" ? "" : "border-[#165DFF] bg-[#EEF4FF] text-[#165DFF] hover:bg-[#E3ECFF]"}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleFormatPainterClick}
          onDoubleClick={handleFormatPainterDoubleClick}
        >
          <Brush className="mr-1 h-4 w-4" />
          {formatPainterMode === "locked"
            ? "格式刷（连续）"
            : formatPainterMode === "single"
              ? "格式刷（单次）"
              : "格式刷"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => imageInputRef.current?.click()}
        >
          <ImagePlus className="mr-1 h-4 w-4" />
          插入图片
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .clearNodes()
              .unsetAllMarks()
              .setColor("#000000")
              .unsetFontSize()
              .setFontFamily("宋体")
              .setTextAlign("left")
              .run()
          }
        >
          <Eraser className="mr-1 h-4 w-4" />
          清除格式
        </Button>
        <button
          type="button"
          className={editorButtonClass(false)}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={editorButtonClass(false)}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 className="h-4 w-4" />
        </button>
      </div>

      <EditorContent editor={editor} />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleInsertImage}
      />
    </div>
  );
}

export function mergeRecommendationIntoHtml(currentHtml: string, recommendationContent: string) {
  const htmlBlock = recommendationContent.includes("<")
    ? recommendationContent
    : `<p>${recommendationContent.replace(/\n/g, "</p><p>")}</p>`;
  return appendHtmlBlock(currentHtml, htmlBlock);
}
