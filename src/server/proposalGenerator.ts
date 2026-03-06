import { getOpenAIClient, DEFAULT_MODEL } from "./openaiClient";
import { loadSnippetLibrary } from "./libraryStore";
import { loadProcurementGuide } from "./proposalGuide";

export interface GenerateProposalInput {
  /** 招标 / 磋商文件全文或核心技术、商务要求 */
  tenderText: string;
  /** 供应商公司介绍、资质、案例等基础信息 */
  companyProfile: string;
  /** 可选：以往成功案例或素材片段（可以是合并后的大段文字） */
  caseLibraryText?: string;
  /** 可选：本次投标的特殊约束，比如“必须不偏离付款条款” */
  extraConstraints?: string;
}

export interface GenerateProposalOptions {
  /** 控制生成标书的语言和风格，目前只考虑中文 */
  language?: "zh";
  /** 生成字数上限提示（模型不一定完全遵守，仅作参考） */
  maxWordsHint?: number;
}

export interface GenerateProposalResult {
  /** 完整标书正文（Markdown / 富文本友好） */
  fullText: string;
  /** 方便前端展示的大纲结构 */
  outline: string;
  /** 本次生成时用于参考的片段简要信息，方便前端展示“复用了哪些历史表达” */
  usedSections?: {
    sectionKey: string;
    sectionTitle: string;
    exampleCount: number;
  }[];
}

const procurementGuideCache = loadProcurementGuide();

/** 拼接用于生成标书的 System Prompt */
function buildSystemPrompt(language: "zh" | undefined, hasSnippetLib: boolean): string {
  const base = `
你是一名资深的“政府采购 / 金融行业监管报送系统”投标方案专家和标书顾问，熟悉中国招投标规则、政府采购法，以及银行/金融机构对监管数据报送系统的常见要求。

你的任务：根据用户提供的“招标 / 磋商文件内容”和“供应商公司情况”，
编写一份完整、专业、符合中国政府采购/金融行业惯例的【竞争性磋商采购响应文件】（电子版标书草稿），
供人工最终审核和修改后使用。

输出要求：
1. 使用正式书面中文，语气严谨、专业。
2. 严格按照以下结构组织文档（如招标文件有更细结构，你可以在对应部分内部细化小节）：
   第一部分：资信标（资格审查与资信证明）
   第二部分：商务标（商务响应与合同条款）
   第三部分：技术标（核心实施方案）
   第四部分：报价标（价格与商务报价）
   第五部分：其他必备文件
3. 每一部分内部，要有清晰的小节标题和编号（例如 1.1、1.2、2.1 等），方便后续生成目录。
4. 技术方案部分（第三部分）要重点突出：监管数据报送全流程、系统总体架构、信创适配、数据安全与权限控制、日志审计与备份恢复等。
5. 报价部分不要给出具体金额数字（因为会由用户后填），而是给出【报价结构说明】和【报价构成要素】，比如“软件开发费用”“实施服务费用”“运维服务费用”等。
6. 如果用户提供了成功案例或既有系统，请在“成功案例”小节中适当引用和改写，但不要泄露真实客户名称（可以用“某股份制商业银行”等泛化表述）。
7. 谨慎处理“偏离”：默认不主动提出负偏离，除非用户输入中已经明确存在差异，可在“技术偏离表 / 服务偏离表”中以文字说明。
`;

  const reuseNote = hasSnippetLib
    ? `
补充要求（非常重要）：
- 用户已经提供了一份【历史标书表达片段库】（按大纲小节整理），其中的内容全部来自他自己写过的标书。
- 在生成本次标书时，你应当“优先复用这些历史表达”，在不违背本次招标文件要求的前提下，尽量沿用原有措辞和结构。
- 对于片段库中没有覆盖到的内容，再由你结合招标文件和公司情况进行补充和扩写。
`
    : "";

  const guideIntro = procurementGuideCache
    ? "\n以下是项目方提供的《采购响应文件结构与要点指引》，你在撰写标书时要尽量遵循其结构与要求：\n\n" +
      procurementGuideCache.slice(0, 8000) +
      "\n\n（如有内容超长，可自行概括消化，不必逐字照搬）\n"
    : "";

  return base + reuseNote + guideIntro;
}

/** 拼接 user prompt，把招标文件、公司信息以及“按大纲拆好的历史表达片段库”喂给模型 */
function buildUserPrompt(
  input: GenerateProposalInput,
  opts: GenerateProposalOptions,
  snippetText: string | null
): string {
  const { tenderText, companyProfile, caseLibraryText, extraConstraints } = input;
  const { maxWordsHint } = opts;

  const parts: string[] = [];

  parts.push("【一、招标 / 磋商文件（节选或全文）】\n");
  parts.push(tenderText.trim());

  parts.push("\n\n【二、投标人公司情况与能力介绍】\n");
  parts.push(companyProfile.trim());

  if (snippetText) {
    parts.push(
      "\n\n【三、用户历史标书表达片段库（按大纲整理）】\n" +
        "下面的内容是用户历史多份标书中，针对不同大纲小节整理出来的典型表达方式。\n" +
        "在生成本次标书时，请在不违背本次招标文件要求的前提下，“尽量沿用这些表达”，必要时可以稍作改写或拼接。\n" +
        "如果某个小节在片段库中没有合适表达，再由你自行补充。\n\n"
    );
    parts.push(snippetText);
  }

  if (caseLibraryText && caseLibraryText.trim()) {
    parts.push("\n\n【四、公司既有成功案例与素材片段】\n");
    parts.push(caseLibraryText.trim());
  }

  if (extraConstraints && extraConstraints.trim()) {
    parts.push("\n\n【五、本次投标的特别约束 / 关键注意事项】\n");
    parts.push(extraConstraints.trim());
  }

  parts.push("\n\n【六、生成要求】\n");
  parts.push(
    [
      "- 请根据上述信息，直接输出一份完整的“竞争性磋商采购响应文件”（标书草稿），不需要再向我提问。",
      "- 文档中不要出现“上文提到”“如下所示”等 AI 口语化表达，要像真实投标文件一样正式、完整。",
      maxWordsHint
        ? `- 建议控制整体篇幅在约 ${maxWordsHint} 字左右，可上下浮动，无需刻意卡死字数。`
        : "- 篇幅可以根据需求合理展开，技术标和实施方案部分要写得更详细一些。",
    ].join("\n")
  );

  parts.push(
    "\n\n【七、输出格式】\n" +
      "- 直接输出 Markdown 文本即可，保留清晰的标题层级（#、##、### 等）和列表结构，方便前端渲染。\n" +
      "- 不需要再重复我的输入内容。"
  );

  return parts.join("\n");
}

export async function generateProposal(
  input: GenerateProposalInput,
  options: GenerateProposalOptions = {}
): Promise<GenerateProposalResult> {
  if (!input.tenderText?.trim()) {
    throw new Error("tenderText 不能为空：需要提供招标 / 磋商文件内容。");
  }
  if (!input.companyProfile?.trim()) {
    throw new Error("companyProfile 不能为空：需要提供投标人公司基本情况。");
  }

  const language: "zh" = options.language ?? "zh";

  const snippetLib = loadSnippetLibrary();
  const hasSnippetLib = !!(snippetLib && snippetLib.sections?.length);

  // 为了控制长度，只取部分片段并进行简单压缩
  let snippetText: string | null = null;
  let usedSections:
    | {
        sectionKey: string;
        sectionTitle: string;
        exampleCount: number;
      }[]
    | undefined;

  if (hasSnippetLib && snippetLib) {
    const lines: string[] = [];
    const used: {
      sectionKey: string;
      sectionTitle: string;
      exampleCount: number;
    }[] = [];

    const MAX_SECTIONS = 20;
    const MAX_EXAMPLES_PER_SECTION = 5;

    snippetLib.sections.slice(0, MAX_SECTIONS).forEach((s, idx) => {
      const examples = (s.examples || []).slice(0, MAX_EXAMPLES_PER_SECTION);
      if (!examples.length) return;

      lines.push(
        `【片段小节 ${idx + 1}】${s.sectionTitle}（key: ${s.sectionKey}）\n` +
          examples.map((e, i) => `- 表达 ${i + 1}：${e}`).join("\n")
      );

      used.push({
        sectionKey: s.sectionKey,
        sectionTitle: s.sectionTitle,
        exampleCount: examples.length,
      });
    });

    if (lines.length) {
      snippetText = lines.join("\n\n");
      usedSections = used;
    }
  }

  const systemPrompt = buildSystemPrompt(language, !!snippetText);
  const userPrompt = buildUserPrompt(input, options, snippetText);

  const openai = getOpenAIClient();

  const completion = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    temperature: 0.5,
  });

  const fullText = completion.choices[0]?.message?.content ?? "";

  // 这里的 outline 先简单做：从正文中提取一级标题，方便前端展示目录
  const outline = fullText
    .split("\n")
    .filter((line) => /^#{1,3}\s+/.test(line.trim()))
    .join("\n");

  return {
    fullText,
    outline,
    usedSections,
  };
}

