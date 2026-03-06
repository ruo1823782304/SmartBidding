import express from "express";
import cors from "cors";
import { generateProposal } from "./proposalGenerator";
import { appendProposal, loadProposals, loadSnippetLibrary } from "./libraryStore";
import { analyzeProposalLibrary } from "./analyzeLibrary";
import { loadConfig, updateConfig } from "./openaiClient";

const app = express();

app.use(
  cors({
    origin: "*", // 如需更严格控制可改成前端实际域名
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "proposal-backend", time: new Date().toISOString() });
});

// === OpenAI 配置接口（用于在网页中配置全局 API Key 和模型） ===

app.get("/api/admin/config", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    success: true,
    data: {
      hasApiKey: !!cfg.openaiApiKey,
      model: cfg.openaiModel || null,
    },
  });
});

app.post("/api/admin/config", (req, res) => {
  const { openaiApiKey, openaiModel } = req.body || {};
  if (!openaiApiKey || !String(openaiApiKey).trim()) {
    return res
      .status(400)
      .json({ success: false, message: "openaiApiKey 不能为空，请填写有效的 API Key。" });
  }
  updateConfig({
    openaiApiKey: String(openaiApiKey).trim(),
    openaiModel: openaiModel ? String(openaiModel).trim() : undefined,
  });
  res.json({ success: true });
});

// === 标书库相关接口 ===

// 上传一份已经写好的标书（文本/Markdown）
app.post("/api/library/proposals", (req, res) => {
  const { name, content } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: "name 不能为空（请传入标书名称）" });
  }
  if (!content || !String(content).trim()) {
    return res.status(400).json({ success: false, message: "content 不能为空（请传入标书全文）" });
  }
  const stored = appendProposal(String(name), String(content));
  res.json({ success: true, data: stored });
});

// 列出当前标书库的所有标书（不返回正文，避免过大）
app.get("/api/library/proposals", (_req, res) => {
  const list = loadProposals().map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
  }));
  res.json({ success: true, data: list });
});

// 获取最近一次“表达片段库”的摘要，方便前端展示是否已分析
app.get("/api/library/snippet-library", (_req, res) => {
  const lib = loadSnippetLibrary();
  if (!lib) {
    return res.json({ success: true, data: null });
  }
  res.json({
    success: true,
    data: {
      updatedAt: lib.updatedAt,
      outlineNote: lib.outlineNote,
      sectionCount: lib.sections.length,
    },
  });
});

// 点击“分析”按钮时调用：用大模型分析当前标书库，生成片段库
app.post("/api/library/analyze", async (_req, res) => {
  try {
    const lib = await analyzeProposalLibrary();
    res.json({
      success: true,
      data: {
        updatedAt: lib.updatedAt,
        outlineNote: lib.outlineNote,
        sectionCount: lib.sections.length,
      },
    });
  } catch (err: any) {
    console.error("[/api/library/analyze] error:", err);
    res.status(400).json({
      success: false,
      message: err?.message || "分析标书库失败",
    });
  }
});

app.post("/api/generate-proposal", async (req, res) => {
  try {
    const { tenderText, companyProfile, caseLibraryText, extraConstraints, maxWordsHint } =
      req.body || {};

    const result = await generateProposal(
      {
        tenderText: String(tenderText || ""),
        companyProfile: String(companyProfile || ""),
        caseLibraryText: caseLibraryText ? String(caseLibraryText) : undefined,
        extraConstraints: extraConstraints ? String(extraConstraints) : undefined,
      },
      {
        language: "zh",
        maxWordsHint: typeof maxWordsHint === "number" ? maxWordsHint : undefined,
      }
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    console.error("[/api/generate-proposal] error:", err);
    res.status(400).json({
      success: false,
      message: err?.message || "生成标书失败",
    });
  }
});

const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proposal backend listening on http://0.0.0.0:${PORT}`);
});

