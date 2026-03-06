import { getOpenAIClient, DEFAULT_MODEL } from "./openaiClient";
import {
  loadProposals,
  saveSnippetLibrary,
  SnippetLibrary,
  SectionSnippet,
} from "./libraryStore";
import { loadProcurementGuide } from "./proposalGuide";

/** 把多份标书拆成“按大纲组织的表达片段库” */
export async function analyzeProposalLibrary(): Promise<SnippetLibrary> {
  const proposals = loadProposals();
  if (!proposals.length) {
    throw new Error("当前标书库为空，请先上传至少一份标书后再点击【分析】。");
  }

  const guide = loadProcurementGuide();

  // 为了 prompt 长度安全，这里做个简单限制：只取最近 N 份标书
  const MAX_DOCS = 8;
  const latest = [...proposals]
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, MAX_DOCS);

  const docsText = latest
    .map(
      (p, idx) =>
        `【文档 ${idx + 1}：${p.name}】\n` +
        // 每份截断到一定长度，避免太长
        p.content.slice(0, 20000)
    )
    .join("\n\n---------------------\n\n");

  const systemPrompt = `
你是一名资深投标顾问，现在要帮用户把“已经写过的多份标书”总结成一个【可复用表达片段库】。

目标：
1. 按照用户习惯的大纲结构（资信标、商务标、技术标、报价标、其他）和细分小节，
   提取出每个小节下，用户已经写过的多种中文表达方式（句子或小段落），供后续自动写标书时优先复用。
2. 如果多份标书中，针对同一件事情有不同说法，要尽量全部保留下来。

输出格式：严格输出 JSON，不要添加任何多余文字。例如：
{
  "outlineNote": "简要说明本片段库基于哪些标书生成",
  "sections": [
    {
      "sectionKey": "credit.qualification",
      "sectionTitle": "第一部分 资信标 / 资格证明文件",
      "examples": [
        "本公司系依法在中国境内设立的股份有限公司，具有独立法人资格……",
        "投标人已通过 ISO9001 质量管理体系认证，持续为金融行业提供稳定可靠的解决方案……"
      ]
    },
    {
      "sectionKey": "tech.overall-architecture",
      "sectionTitle": "第三部分 技术标 / 系统总体架构",
      "examples": [
        "本项目拟采用“数据采集层—数据处理层—数据服务层—报送接入层”的四层总体架构……"
      ]
    }
  ]
}

注意事项：
- examples 中的内容应尽量保持用户原有标书的措辞和风格，只做少量通顺化处理即可。
- 不需要覆盖所有可能的小节，只要是标书中反复出现的、以后有复用价值的内容就可以收录。
- 每个小节 examples 建议 3~10 条之间，过多会影响后续调用效果。
`;

  const userParts: string[] = [];
  if (guide) {
    userParts.push("【一、用户提供的大纲与写作指引（节选）】\n");
    userParts.push(guide.slice(0, 8000));
  }
  userParts.push("\n\n【二、需要你分析的历史标书文本】\n");
  userParts.push(docsText);
  userParts.push(
    "\n\n【三、任务】\n" +
      "请根据上述标书文本，抽取可复用的表达片段，并严格按照 System Prompt 中给出的 JSON 结构返回。"
  );

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
        content: userParts.join("\n"),
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: SnippetLibrary;
  try {
    parsed = JSON.parse(raw) as SnippetLibrary;
  } catch (err) {
    console.error("[analyzeProposalLibrary] 解析模型返回 JSON 失败：", err);
    throw new Error("大模型返回数据格式异常，请稍后重试或检查日志。");
  }

  // 简单校验结构
  if (!parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error("大模型未返回有效的 sections 结构，请稍后重试。");
  }

  // 去掉空 examples
  const cleanedSections: SectionSnippet[] = parsed.sections
    .map((s) => ({
      ...s,
      examples: (s.examples || []).filter((e) => typeof e === "string" && e.trim().length > 0),
    }))
    .filter((s) => s.examples.length > 0);

  const lib: SnippetLibrary = {
    updatedAt: new Date().toISOString(),
    outlineNote: parsed.outlineNote,
    sections: cleanedSections,
  };

  saveSnippetLibrary(lib);

  return lib;
}

