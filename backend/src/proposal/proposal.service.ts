import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { buildProposalDocxBuffer } from './proposal-export.util';
import {
  flattenOutlineGroups,
  normalizeOutlineGroups,
  type OutlineGroup,
} from './proposal-outline.util';

type ComplianceSectionKey = 'check' | 'score' | 'library';
type ComplianceSeverity = 'high' | 'medium' | 'low';

type ComplianceSuggestionItem = {
  title: string;
  problem: string;
  suggestion: string;
  evidence?: string;
  severity: ComplianceSeverity;
};

type ComplianceSuggestionSection = {
  key: ComplianceSectionKey;
  title: string;
  summary: string;
  items: ComplianceSuggestionItem[];
};

type ComplianceRecommendationResponse = {
  summary: string;
  riskCount: number;
  highRiskCount: number;
  generatedAt: string;
  sections: ComplianceSuggestionSection[];
};

type ComplianceAiResponse = {
  summary?: string;
  sections?: Array<{
    key?: string;
    title?: string;
    summary?: string;
    items?: Array<{
      title?: string;
      problem?: string;
      suggestion?: string;
      evidence?: string;
      severity?: string;
    }>;
  }>;
};

const COMPLIANCE_SECTION_KEYS: ComplianceSectionKey[] = ['check', 'score', 'library'];

@Injectable()
export class ProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async listSections(projectId: string) {
    const sections = await this.prisma.sectionContent.findMany({
      where: { projectId },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return {
      list: sections.map((section) => ({
        sectionKey: section.sectionKey,
        content: section.content,
        completed: section.completed,
        version: section.version,
        lastEditedAt: section.lastEditedAt?.toISOString(),
        lastEditedBy: section.lastEditedBy ?? undefined,
      })),
    };
  }

  async getSectionContent(projectId: string, sectionKey: string) {
    const section = await this.prisma.sectionContent.findUnique({
      where: { projectId_sectionKey: { projectId, sectionKey } },
    });
    if (!section)
      return {
        content: '',
        version: 0,
        lastEditedAt: undefined,
        lastEditedBy: undefined,
      };
    return {
      content: section.content,
      completed: section.completed,
      version: section.version,
      lastEditedAt: section.lastEditedAt?.toISOString(),
      lastEditedBy: section.lastEditedBy ?? undefined,
    };
  }

  async saveSectionContent(projectId: string, sectionKey: string, content: string, lastEditedBy?: string) {
    const updated = await this.prisma.sectionContent.upsert({
      where: { projectId_sectionKey: { projectId, sectionKey } },
      create: {
        projectId,
        sectionKey,
        content,
        lastEditedBy,
        lastEditedAt: new Date(),
      },
      update: {
        content,
        version: { increment: 1 },
        lastEditedBy,
        lastEditedAt: new Date(),
      },
    });
    return { success: true, version: updated.version };
  }

  async setSectionComplete(projectId: string, sectionKey: string, completed: boolean) {
    await this.prisma.sectionContent.upsert({
      where: { projectId_sectionKey: { projectId, sectionKey } },
      create: { projectId, sectionKey, content: '', completed },
      update: { completed },
    });
    return { success: true };
  }

  async getRecommendations(projectId: string, sectionKey: string, title?: string) {
    const keyword = this.extractRecommendationKeyword(title || sectionKey);
    const assets = await this.prisma.asset.findMany({
      where: keyword
        ? {
            OR: [
              { title: { contains: keyword, mode: 'insensitive' } },
              { snippet: { contains: keyword, mode: 'insensitive' } },
              { content: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : undefined,
      take: 16,
      orderBy: { uploadedAt: 'desc' },
      select: { id: true, title: true, category: true, subtype: true, snippet: true, content: true },
    });

    const ranked = assets
      .map((asset) => ({
        ...asset,
        score: this.scoreAssetMatch(keyword, asset.title, asset.snippet, asset.content),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);

    return {
      list: ranked.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        subtype: a.subtype ?? undefined,
        content: a.content ?? undefined,
        snippet: a.snippet ?? undefined,
        score: a.score,
      })),
    };
  }

  async getComplianceRecommendations(projectId: string): Promise<ComplianceRecommendationResponse> {
    const [project, latestParse, assets] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, tenderOutline: true },
      }),
      this.prisma.parseResult.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      this.prisma.asset.findMany({
        where: {
          category: {
            in: ['qualification', 'performance', 'solution', 'winning', 'resume'],
          },
        },
        orderBy: { uploadedAt: 'desc' },
        take: 12,
        select: {
          title: true,
          category: true,
          subtype: true,
          snippet: true,
        },
      }),
    ]);

    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    if (!latestParse) {
      return {
        summary: '当前项目还没有可用于生成修改建议的解析结果。',
        riskCount: 0,
        highRiskCount: 0,
        generatedAt: new Date().toISOString(),
        sections: COMPLIANCE_SECTION_KEYS.map((key) => ({
          key,
          title: this.sectionTitle(key),
          summary: '请先完成标书解析，再进入修改建议页面。',
          items: [],
        })),
      };
    }

    const fallback = this.buildFallbackComplianceRecommendations(
      project.name,
      latestParse.summary ?? project.tenderOutline ?? '',
      latestParse.items,
      assets,
    );
    const aiResult = await this.generateComplianceRecommendationsWithAi(
      project.name,
      latestParse.summary ?? project.tenderOutline ?? '',
      latestParse.items,
      assets,
    );

    return this.mergeComplianceRecommendations(fallback, aiResult);
  }

  async submit(projectId: string, _comment?: string) {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { proposalStatus: '待初审' },
    });
    const task = await this.prisma.task.findFirst({
      where: { projectId, taskType: '标书审核任务' },
    });
    if (task) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: '进行中' },
      });
    }
    return { success: true };
  }

  async exportDoc(projectId: string, format: 'word' | 'pdf', kind: 'tech' | 'biz') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { sections: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (format !== 'word') {
      throw new BadRequestException('当前仅支持 DOCX 下载。');
    }
    const title = `${project.name}_${kind === 'tech' ? '技术标' : '商务标'}`;
    if (format === 'word') {
      return {
        success: true,
        downloadUrl: `/api/projects/${projectId}/proposal/export/file?format=word&kind=${kind}`,
        filename: `${title}.docx`,
      };
    }
    return { success: true, downloadUrl: '', filename: `${title}.docx` };
  }

  async exportDocFile(projectId: string, format: 'word' | 'pdf', kind: 'tech' | 'biz') {
    if (format !== 'word') {
      throw new BadRequestException('当前仅支持 DOCX 下载。');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        techOutlineSections: true,
        bizOutlineSections: true,
        sections: {
          select: {
            sectionKey: true,
            content: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    const outlineGroups = normalizeOutlineGroups(
      kind === 'tech' ? project.techOutlineSections : project.bizOutlineSections,
    );

    if (flattenOutlineGroups(outlineGroups).length === 0) {
      throw new BadRequestException(kind === 'tech' ? '技术标大纲为空，无法导出。' : '商务标大纲为空，无法导出。');
    }

    const sectionContentMap = new Map(project.sections.map((section) => [section.sectionKey, section.content]));
    const buffer = await buildProposalDocxBuffer({
      projectName: project.name,
      kind,
      outlineGroups,
      sectionContentMap,
    });

    return {
      buffer,
      fileName: `${project.name}_${kind === 'tech' ? '技术标' : '商务标'}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  async generateSectionContent(
    projectId: string,
    sectionKey: string,
    input?: {
      context?: string;
      currentContent?: string;
      sectionTitle?: string;
      sectionDetail?: string;
      outlinePath?: string;
      bidKind?: 'tech' | 'biz';
      assetIds?: string[];
      sourceItemIds?: string[];
      boundRequirementText?: string;
      customPrompt?: string;
    },
  ): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        tenderOutline: true,
      },
    });

    const latestParse = await this.prisma.parseResult.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });

    const matchedAssets = input?.assetIds?.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: input.assetIds } },
          select: { title: true, category: true, snippet: true, content: true },
          take: 6,
        })
      : [];

    const sectionTitle = input?.sectionTitle || this.extractRecommendationKeyword(sectionKey) || sectionKey;
    const currentContent = input?.currentContent?.trim();
    const manualBoundRequirementText = input?.boundRequirementText?.trim();
    const customPrompt = input?.customPrompt?.trim();
    const relatedParseItems =
      input?.sourceItemIds?.length && latestParse?.items?.length
        ? this.pickParseItemsByIds(latestParse.items, input.sourceItemIds)
        : this.pickRelevantParseItems(latestParse?.items ?? [], sectionTitle);
    const fallbackRequirementText = relatedParseItems
      .map((item) => `${item.title}\n${item.content}`.trim())
      .filter(Boolean)
      .join('\n\n');
    const primaryRequirementText =
      manualBoundRequirementText || fallbackRequirementText;
    const sectionStrategyPrompt = this.buildSectionStrategyPrompt({
      projectName: project?.name ?? '',
      sectionTitle,
      sectionDetail: input?.sectionDetail,
      boundRequirementText: primaryRequirementText,
      tenderSummary: project?.tenderOutline ?? '',
      parseItems: latestParse?.items ?? [],
      relatedParseItems: manualBoundRequirementText ? [] : relatedParseItems,
    });
    const sectionContext = [
      `项目名称：${project?.name || '未命名项目'}`,
      input?.bidKind ? `当前编制对象：${input.bidKind === 'tech' ? '技术标' : '商务标'}` : '',
      `当前章节：${sectionTitle}`,
      input?.outlinePath ? `章节路径：${input.outlinePath}` : '',
      input?.sectionDetail ? `章节说明：${input.sectionDetail}` : '',
      primaryRequirementText
        ? `${manualBoundRequirementText ? '当前章节原文绑定文本（最高优先级，必须据此生成）' : '当前章节原文要求'}：\n${primaryRequirementText}`
        : '',
      customPrompt
        ? `用户补充 prompt（需融入正文，但不要在正文中直接复述）:\n${customPrompt}`
        : '',
      sectionStrategyPrompt
        ? `系统基于整份标书理解生成的写作策略（用于内部写作，不得直接复述到正文）:\n${sectionStrategyPrompt}`
        : '',
      input?.context ? `补充上下文：\n${input.context}` : '',
      matchedAssets.length > 0
        ? `企业库可复用素材：\n${matchedAssets
            .map((asset) => `- [${asset.category}] ${asset.title}: ${this.trimText(asset.content || asset.snippet, 260)}`)
            .join('\n')}`
        : '',
      currentContent
        ? '如果输入中存在用户当前正文，请只把它作为可参考草稿；当它与“当前章节原文绑定文本”或“用户补充 prompt”冲突时，以后二者为准。'
        : '请直接生成该章节的正式标书正文，内容要完整、专业、可直接编辑。',
      '输出要求：仅输出适合富文本编辑器直接展示的简洁 HTML，可包含 p、ul、ol、li、strong、u、span，不要输出 markdown。',
    ]
      .filter(Boolean)
      .join('\n\n');

    const generated = await this.ai.generateSectionContent(sectionTitle, sectionContext);
    const sanitizedGenerated = this.sanitizeGeneratedSectionOutput(generated);
    if (sanitizedGenerated.trim()) {
      return sanitizedGenerated;
    }

    if (currentContent) {
      return `<p>${currentContent.replace(/\n/g, '</p><p>')}</p>`;
    }

    return [
      `<p><strong>${sectionTitle}</strong></p>`,
      input?.sectionDetail ? `<p>${input.sectionDetail}</p>` : '',
      primaryRequirementText
        ? `<p>${primaryRequirementText.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`
        : relatedParseItems[0]?.content
          ? `<p>${relatedParseItems[0].content}</p>`
          : '<p>请结合招标要求补充本章节内容。</p>',
    ]
      .filter(Boolean)
      .join('');
  }

  private buildSectionStrategyPrompt(params: {
    projectName: string;
    sectionTitle: string;
    sectionDetail?: string;
    boundRequirementText?: string;
    tenderSummary: string;
    parseItems: Array<{
      majorCode: string;
      title: string;
      content: string;
      sourceQuote?: string | null;
      isRequired: boolean;
      priority?: string | null;
      riskLevel: string;
    }>;
    relatedParseItems: Array<{
      title: string;
      content: string;
      sourceQuote?: string | null;
      majorCode: string;
      isRequired: boolean;
      priority?: string | null;
      riskLevel: string;
    }>;
  }) {
    const combinedSectionText = [
      params.projectName,
      params.sectionTitle,
      params.sectionDetail ?? '',
      params.boundRequirementText ?? '',
      params.tenderSummary,
      ...params.relatedParseItems.map((item) => `${item.title}\n${item.content}`),
    ]
      .filter(Boolean)
      .join('\n');

    const suggestions: string[] = [
      '直接围绕当前章节对应的招标原文逐条响应，不要空泛复述，也不要遗漏显性要求。',
      '尽量采用“要求理解-响应方案-实施或保障措施-交付结果”这种可打分的写法，让评审能够直接对照给分。',
      '优先写可验证内容，例如角色分工、流程机制、交付物、排期、技术指标、响应时限、兼容范围和保障措施。',
    ];

    if (/(银行|金融|监管报送|监管数据报送)/.test(combinedSectionText)) {
      suggestions.push('文字风格要体现银行监管报送场景下的专业性、稳健性、合规性、可审计性和数据准确性。');
    }

    if (/(访问界面|界面友好|用户体验|交互|浏览器|可视化)/.test(combinedSectionText)) {
      suggestions.push('本章节要突出界面友好、操作便捷、主流浏览器兼容、布局清晰、可视化和易维护性，避免只写空泛的“体验良好”。');
    }

    if (/(技术架构|架构|部署|模块|国产|信创)/.test(combinedSectionText)) {
      suggestions.push('技术内容要写清架构层次、部署方式、模块关系、国产化或信创适配策略，以及为什么这样设计能满足招标要求。');
    }

    if (/(安全|权限|审计|日志|加密)/.test(combinedSectionText)) {
      suggestions.push('安全响应要写明认证鉴权、权限控制、日志审计、敏感数据保护和安全运维措施，不要只写“满足安全要求”。');
    }

    if (/(备份|容灾|恢复|高可用|稳定性)/.test(combinedSectionText)) {
      suggestions.push('备份和高可用内容要写出备份机制、恢复策略、故障处理思路和连续服务保障，尽量避免口号式描述。');
    }

    if (/(数据质量|数据加工|校验|准确性|一致性)/.test(combinedSectionText)) {
      suggestions.push('数据质量相关内容要写出校验规则、加工流程、异常处理和结果核验机制，强调准确、完整、一致和可追溯。');
    }

    if (/(项目管理|实施计划|进度|里程碑|时间节点|工作分工)/.test(combinedSectionText)) {
      suggestions.push('实施和管理内容要写明阶段划分、关键里程碑、时间安排、责任分工、沟通机制和阶段交付物。');
    }

    if (/(团队|人员|项目经理|架构师|开发|测试|实施)/.test(combinedSectionText)) {
      suggestions.push('团队响应要明确核心角色、岗位职责、相关经验、证书或项目经历，以及这些人员如何支撑本项目落地。');
    }

    if (/(培训|运维|保修|故障处理|响应速度|支持承诺)/.test(combinedSectionText)) {
      suggestions.push('服务内容要写清培训对象与计划、运维保障边界、故障分级处理、响应时限和长期支持承诺。');
    }

    const scoringItems = params.parseItems
      .map((item) => ({
        item,
        score:
          this.scoreAssetMatch(params.sectionTitle, item.title, item.sourceQuote, item.content) +
          (item.majorCode === 'review_requirements' ? 80 : 0) +
          (/(评分|评审|得分|分值|评分标准)/.test(`${item.title}\n${item.content}`) ? 40 : 0) +
          (item.isRequired ? 20 : 0) +
          (item.priority === 'high' ? 12 : 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((entry) => entry.item);

    if (scoringItems.length > 0) {
      suggestions.push(
        `写作时要兼顾以下评审或得分关注点：${scoringItems.map((item) => item.title.trim()).filter(Boolean).join('；')}。`,
      );
    }

    const directRequirementTitles = params.relatedParseItems
      .map((item) => item.title.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (directRequirementTitles.length > 0) {
      suggestions.push(`优先覆盖本章节直接关联的原文条款：${directRequirementTitles.join('；')}。`);
    }

    return suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n');
  }

  private sanitizeGeneratedSectionOutput(content: string) {
    let next = content.trim();
    if (!next) {
      return '';
    }

    for (let index = 0; index < 3; index += 1) {
      const strippedParagraph = this.stripLeadingMetaParagraph(next);
      if (strippedParagraph === next) {
        break;
      }
      next = strippedParagraph.trim();
    }

    return next;
  }

  private stripLeadingMetaParagraph(content: string) {
    const htmlMatch = content.match(/^<p[^>]*>([\s\S]*?)<\/p>/i);
    if (htmlMatch) {
      const paragraphText = this.toPlainText(htmlMatch[1]);
      if (this.looksLikePromptEcho(paragraphText)) {
        return content.slice(htmlMatch[0].length).trim();
      }
      return content;
    }

    const firstBlock = content.split(/\n{2,}/)[0]?.trim() ?? '';
    if (firstBlock && this.looksLikePromptEcho(firstBlock)) {
      return content.slice(firstBlock.length).trim();
    }

    return content;
  }

  private toPlainText(value: string) {
    return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  private looksLikePromptEcho(text: string) {
    const normalized = text.replace(/\s+/g, '');
    return [
      '用户需要我',
      '我需要撰写',
      '我将撰写',
      '直接输出HTML',
      '不要markdown',
      '参考上下文',
      '补充prompt',
      '内容包括',
      '要求1.',
      '要求：1.',
    ].some((keyword) => normalized.includes(keyword.replace(/\s+/g, '')));
  }

  private extractRecommendationKeyword(value?: string | null) {
    const normalized = (value ?? '')
      .split(/\/|::|>/)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1) || '';

    return normalized.replace(/^[一二三四五六七八九十0-9.\-、\s]+/, '').trim() || normalized;
  }

  private scoreAssetMatch(keyword: string, title: string, snippet?: string | null, content?: string | null) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedTitle = title.trim().toLowerCase();
    const normalizedSnippet = (snippet ?? '').trim().toLowerCase();
    const normalizedContent = (content ?? '').trim().toLowerCase();

    if (!normalizedKeyword) {
      return 0;
    }

    let score = 0;
    if (normalizedTitle === normalizedKeyword) {
      score += 120;
    }
    if (normalizedTitle.includes(normalizedKeyword)) {
      score += 80;
    }
    if (normalizedSnippet.includes(normalizedKeyword)) {
      score += 40;
    }
    if (normalizedContent.includes(normalizedKeyword)) {
      score += 24;
    }

    const overlap = normalizedKeyword
      .split(/\s+/)
      .filter(Boolean)
      .filter((part) => normalizedTitle.includes(part) || normalizedSnippet.includes(part)).length;
    score += overlap * 10;

    return score;
  }

  private pickRelevantParseItems<
    T extends { id?: string; title: string; content: string; sourceQuote?: string | null }
  >(items: T[], keyword: string) {
    const normalizedKeyword = this.extractRecommendationKeyword(keyword).toLowerCase();
    return items
      .map((item) => ({
        item,
        score: this.scoreAssetMatch(normalizedKeyword, item.title, item.sourceQuote, item.content),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map((entry) => entry.item);
  }

  private pickParseItemsByIds<
    T extends { id?: string | null; title: string; content: string; sourceQuote?: string | null }
  >(items: T[], sourceItemIds: string[]) {
    const order = new Map(sourceItemIds.map((id, index) => [id, index]));
    return items
      .filter((item): item is T & { id: string } => {
        const id = item.id;
        return typeof id === 'string' && order.has(id);
      })
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
      .slice(0, 8);
  }

  private sectionTitle(key: ComplianceSectionKey) {
    if (key === 'check') return '智能审查';
    if (key === 'score') return '对标评分';
    return '合规库查询';
  }

  private normalizeSeverity(value?: string | null): ComplianceSeverity {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }
    return 'medium';
  }

  private severityOrder(value: ComplianceSeverity) {
    if (value === 'high') return 3;
    if (value === 'medium') return 2;
    return 1;
  }

  private trimText(value?: string | null, max = 160) {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return '';
    }
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }

  private groupParseItems(items: Array<{
    majorCode: string;
    title: string;
    content: string;
    sourceQuote?: string | null;
    riskLevel: string;
    isRequired: boolean;
  }>) {
    const grouped = new Map<string, typeof items>();
    items.forEach((item) => {
      const list = grouped.get(item.majorCode) ?? [];
      list.push(item);
      grouped.set(item.majorCode, list);
    });
    return grouped;
  }

  private rankParseItems<T extends { riskLevel: string; isRequired: boolean }>(items: T[]) {
    return [...items].sort((left, right) => {
      const riskDiff = this.severityOrder(this.normalizeSeverity(right.riskLevel)) - this.severityOrder(this.normalizeSeverity(left.riskLevel));
      if (riskDiff !== 0) {
        return riskDiff;
      }
      if (left.isRequired !== right.isRequired) {
        return left.isRequired ? -1 : 1;
      }
      return 0;
    });
  }

  private buildCheckSuggestion(item: {
    title: string;
    content: string;
    sourceQuote?: string | null;
    riskLevel: string;
    majorCode: string;
  }): ComplianceSuggestionItem {
    const suggestionByMajor: Record<string, string> = {
      invalid_and_rejection:
        '请把这条否决或废标条件转成投标前自检清单，逐项核对响应文件是否有明确承诺、证明材料和页码映射，避免因缺项被直接判无效。',
      required_submission_documents:
        '请在目录和附件索引中单列这项提交件，补齐原件/复印件、签字盖章、扫描件清晰度和页码指引。',
      qualification_requirements:
        '请补齐对应的资质、财务、业绩或人员证明，并核对有效期、盖章页和扫描清晰度，避免资格审查卡点。',
      bid_document_requirements:
        '请按招标文件要求校正签字、盖章、编排顺序、密封和递交格式，重点核查容易被忽略的形式要件。',
      tender_document_review:
        '请结合该条款补充偏离说明和风险承诺，避免正文、偏离表与附件之间出现口径不一致。',
    };

    return {
      title: item.title,
      problem: this.trimText(item.content, 180),
      suggestion:
        suggestionByMajor[item.majorCode] ??
        '请将这一要求拆成可执行的逐项检查动作，并在投标文件中补齐对应证明、承诺或引用页码。',
      evidence: this.trimText(item.sourceQuote || item.content, 120),
      severity: this.normalizeSeverity(item.riskLevel),
    };
  }

  private buildScoreSuggestion(item: {
    title: string;
    content: string;
    sourceQuote?: string | null;
    riskLevel: string;
  }): ComplianceSuggestionItem {
    const content = item.content;
    let suggestion =
      '请围绕该评分点补充量化指标、案例映射、实施方法和可交付承诺，让评委能直接对照评分标准打分。';

    if (/(案例|业绩|经验)/.test(content)) {
      suggestion = '请补充同类项目案例、客户名称、建设范围、验收结果和成效指标，并把案例内容与评分点一一映射。';
    } else if (/(团队|人员|项目经理|简历)/.test(content)) {
      suggestion = '请补强核心团队配置、岗位职责、项目经理履历和关键人员证书，突出与本项目的直接匹配度。';
    } else if (/(工期|进度|实施|服务)/.test(content)) {
      suggestion = '请把实施路径、里程碑、资源投入和服务响应指标写成可量化内容，并补充阶段性交付物。';
    } else if (/(技术|方案|架构|安全)/.test(content)) {
      suggestion = '请把技术架构、关键能力、安全合规和信创适配内容写得更具体，并补充验证方法与落地路径。';
    }

    return {
      title: item.title,
      problem: this.trimText(content, 180),
      suggestion,
      evidence: this.trimText(item.sourceQuote || content, 120),
      severity: this.normalizeSeverity(item.riskLevel),
    };
  }

  private inferAssetCategory(item: { title: string; content: string }) {
    const text = `${item.title}\n${item.content}`;
    if (/(简历|项目经理|人员|团队)/.test(text)) return 'resume';
    if (/(业绩|案例|实施项目|客户)/.test(text)) return 'performance';
    if (/(技术|方案|实施|架构|安全|服务)/.test(text)) return 'solution';
    if (/(中标|成交)/.test(text)) return 'winning';
    return 'qualification';
  }

  private buildLibrarySuggestion(
    item: {
      title: string;
      content: string;
      sourceQuote?: string | null;
      riskLevel: string;
    },
    assets: Array<{ title: string; category: string; subtype: string | null; snippet: string | null }>,
  ): ComplianceSuggestionItem {
    const targetCategory = this.inferAssetCategory(item);
    const asset = assets.find((entry) => entry.category === targetCategory);
    const categoryLabelMap: Record<string, string> = {
      qualification: '资质材料',
      performance: '项目业绩',
      solution: '技术方案',
      winning: '中标案例',
      resume: '人员简历',
    };

    const suggestion = asset
      ? `建议优先调用企业库中的「${asset.title}」，结合本项目要求重写后引用到对应章节，避免从零编写导致响应不充分。`
      : `当前企业库里还没有可直接引用的${categoryLabelMap[targetCategory] ?? '支撑材料'}，建议先补充入库，再回填到本项目。`;
    const evidenceParts = [this.trimText(item.sourceQuote || item.content, 100)];
    if (asset) {
      evidenceParts.push(`企业库命中：${asset.title}`);
    }

    return {
      title: item.title,
      problem: this.trimText(item.content, 180),
      suggestion,
      evidence: evidenceParts.filter(Boolean).join('；'),
      severity: this.normalizeSeverity(item.riskLevel),
    };
  }

  private buildFallbackComplianceRecommendations(
    projectName: string,
    summary: string,
    items: Array<{
      majorCode: string;
      title: string;
      content: string;
      sourceQuote?: string | null;
      riskLevel: string;
      isRequired: boolean;
    }>,
    assets: Array<{ title: string; category: string; subtype: string | null; snippet: string | null }>,
  ): ComplianceRecommendationResponse {
    const grouped = this.groupParseItems(items);
    const checkCandidates = this.rankParseItems([
      ...(grouped.get('invalid_and_rejection') ?? []),
      ...(grouped.get('required_submission_documents') ?? []),
      ...(grouped.get('qualification_requirements') ?? []),
      ...(grouped.get('bid_document_requirements') ?? []),
      ...(grouped.get('tender_document_review') ?? []),
    ]).slice(0, 4);
    const scoreCandidates = this.rankParseItems(grouped.get('review_requirements') ?? []).slice(0, 4);
    const libraryCandidates = this.rankParseItems([
      ...(grouped.get('qualification_requirements') ?? []),
      ...(grouped.get('review_requirements') ?? []),
      ...(grouped.get('bid_document_requirements') ?? []),
    ]).slice(0, 4);

    const sections: ComplianceSuggestionSection[] = [
      {
        key: 'check',
        title: this.sectionTitle('check'),
        summary: '优先检查资格、附件、废标条款和形式响应完整性，先把容易造成直接失分或废标的问题补齐。',
        items: checkCandidates.map((item) => this.buildCheckSuggestion(item)),
      },
      {
        key: 'score',
        title: this.sectionTitle('score'),
        summary: '围绕评审细则反推得分点，补齐量化描述、案例映射和实施可行性说明。',
        items: scoreCandidates.map((item) => this.buildScoreSuggestion(item)),
      },
      {
        key: 'library',
        title: this.sectionTitle('library'),
        summary: '结合当前招标要求，优先从企业库补充可复用的资质、业绩、简历和技术方案材料。',
        items: libraryCandidates.map((item) => this.buildLibrarySuggestion(item, assets)),
      },
    ];

    const normalizedSections = sections.map((section) => ({
      ...section,
      items: section.items.slice(0, 4),
    }));
    const riskCount = normalizedSections.reduce((total, section) => total + section.items.length, 0);
    const highRiskCount = normalizedSections.reduce(
      (total, section) => total + section.items.filter((item) => item.severity === 'high').length,
      0,
    );

    return {
      summary:
        this.trimText(summary, 220) ||
        `${projectName} 已生成基于解析结果的修改建议，建议优先处理高风险条款和缺失材料，再补强评分项和企业库引用材料。`,
      riskCount,
      highRiskCount,
      generatedAt: new Date().toISOString(),
      sections: normalizedSections,
    };
  }

  private async generateComplianceRecommendationsWithAi(
    projectName: string,
    summary: string,
    items: Array<{
      majorCode: string;
      title: string;
      content: string;
      sourceQuote?: string | null;
      riskLevel: string;
      isRequired: boolean;
    }>,
    assets: Array<{ title: string; category: string; subtype: string | null; snippet: string | null }>,
  ) {
    return this.ai.chatJson<ComplianceAiResponse>({
      task: 'sectionGenerate',
      systemPrompt: [
        '你是资深投标文件审查与优化专家。',
        '请基于招标解析结果输出三个固定分区的真实修改建议。',
        '只返回 JSON，不要输出 Markdown。',
        'Schema:',
        '{"summary":"总体判断","sections":[{"key":"check|score|library","title":"标题","summary":"本分区总结","items":[{"title":"建议标题","problem":"当前问题","suggestion":"可执行修改建议","evidence":"来自解析结果或企业库的依据","severity":"high|medium|low"}]}]}',
        '必须严格输出 check、score、library 三个 section。',
        'check 聚焦资格审查、附件完整性、废标项、形式响应和条款风险。',
        'score 聚焦评分规则、得分点补强和响应策略。',
        'library 聚焦应从企业库补充哪些资质、业绩、简历、技术方案或中标案例。',
        '建议必须具体、可执行，不能空泛。',
        'evidence 只能引用输入中的 parse items 或 assets；如果证据不足，请明确写“当前解析结果未定位到直接证据”，但不要编造。',
      ].join('\n'),
      userContent: JSON.stringify({
        projectName,
        tenderSummary: this.trimText(summary, 600),
        parseItems: items.slice(0, 24).map((item) => ({
          majorCode: item.majorCode,
          title: item.title,
          content: this.trimText(item.content, 220),
          riskLevel: item.riskLevel,
          isRequired: item.isRequired,
          sourceQuote: this.trimText(item.sourceQuote || item.content, 120),
        })),
        enterpriseAssets: assets.slice(0, 10).map((asset) => ({
          title: asset.title,
          category: asset.category,
          subtype: asset.subtype,
          snippet: this.trimText(asset.snippet, 120),
        })),
      }),
      temperature: 0.2,
      maxTokens: 2600,
    });
  }

  private mergeComplianceRecommendations(
    fallback: ComplianceRecommendationResponse,
    aiResult: ComplianceAiResponse | null,
  ): ComplianceRecommendationResponse {
    if (!aiResult?.sections || aiResult.sections.length === 0) {
      return fallback;
    }

    const aiSections = new Map(
      aiResult.sections
        .filter((section): section is NonNullable<ComplianceAiResponse['sections']>[number] => Boolean(section?.key))
        .map((section) => [section.key as ComplianceSectionKey, section]),
    );

    const sections = COMPLIANCE_SECTION_KEYS.map((key) => {
      const base = fallback.sections.find((section) => section.key === key)!;
      const candidate = aiSections.get(key);
      if (!candidate) {
        return base;
      }

      const aiItems = (candidate.items ?? [])
        .map((item): ComplianceSuggestionItem | null => {
          const title = item.title?.trim();
          const problem = item.problem?.trim();
          const suggestion = item.suggestion?.trim();
          if (!title || !problem || !suggestion) {
            return null;
          }
          return {
            title,
            problem,
            suggestion,
            evidence: item.evidence?.trim() || undefined,
            severity: this.normalizeSeverity(item.severity),
          };
        })
        .filter((item): item is ComplianceSuggestionItem => item !== null)
        .slice(0, 4);

      return {
        key,
        title: candidate.title?.trim() || base.title,
        summary: candidate.summary?.trim() || base.summary,
        items: aiItems.length > 0 ? aiItems : base.items,
      };
    });

    const riskCount = sections.reduce((total, section) => total + section.items.length, 0);
    const highRiskCount = sections.reduce(
      (total, section) => total + section.items.filter((item) => item.severity === 'high').length,
      0,
    );

    return {
      summary: aiResult.summary?.trim() || fallback.summary,
      riskCount,
      highRiskCount,
      generatedAt: new Date().toISOString(),
      sections,
    };
  }
}
