import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ParseJobStage, ParseJobStatus, ParseResultItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ProjectService } from '../project/project.service';
import { StorageService } from '../storage/storage.service';
import { DocumentService } from '../document/document.service';
import { QueueService } from '../queue/queue.service';
import { TENDER_PARSE_CATALOG } from '../rag/tender-parse.catalog';
import { TENDER_STRUCTURED_SCHEMA } from '../rag/tender-structured.schema';
import { normalizeOutlineGroups, type OutlineGroup } from '../proposal/proposal-outline.util';

const REFERENCE_OUTLINE_HINTS = {
  usage: [
    '参考目录只能用于补盲、命名优化和结构校验，不能替代当前招标文件原文。',
    '如果参考建议与原文冲突，必须以当前招标文件原文为准。',
  ],
  technicalFallback: ['访问交互', '技术架构', '国产化适配', '安全设计', '备份恢复', '高可用', '数据质量'],
  serviceFallback: ['项目管理方案', '实施计划', '开发方法', '测试方法', '配置管理', '技术转移', '培训方案', '运维保修'],
  businessFallback: ['资格证明文件', '偏离表', '商务承诺', '报价文件'],
};

@Injectable()
export class TenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly project: ProjectService,
    private readonly storage: StorageService,
    private readonly documentService: DocumentService,
    private readonly queueService: QueueService,
  ) {}

  async upload(projectId: string, file: Express.Multer.File) {
    if (!projectId) {
      throw new BadRequestException('projectId is required.');
    }
    if (!file) {
      throw new BadRequestException('Tender file is required.');
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const objectKey = `tender/${projectId}/${Date.now()}_${this.safeFileName(file.originalname)}`;
    const storedObject = await this.storage.uploadBuffer(objectKey, file.buffer, {
      'Content-Type': file.mimetype || 'application/octet-stream',
      'Original-File-Name': encodeURIComponent(file.originalname),
    });

    const created = await this.documentService.createTenderUpload({
      projectId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageBucket: storedObject.bucket,
      storageKey: storedObject.key,
      fileBuffer: file.buffer,
    });

    return {
      success: true,
      fileId: created.tenderFileId,
      documentId: created.documentId,
      documentVersionId: created.documentVersionId,
      versionNo: created.versionNo,
      fileName: file.originalname,
      size: String(file.size),
    };
  }

  async parse(projectId: string, fileId?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const source = await this.documentService.resolveTenderSource(projectId, fileId);
    const parseJob = await this.documentService.createParseJob(projectId, source.documentId, source.documentVersionId);

    await this.queueService.enqueueTenderParse({ parseJobId: parseJob.id });

    return {
      success: true,
      taskId: parseJob.id,
      parseJobId: parseJob.id,
      status: parseJob.status,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
    };
  }

  async getParseResult(projectId?: string, taskId?: string) {
    const job = taskId
      ? await this.documentService.getParseJobWithResult(taskId)
      : projectId
        ? await this.documentService.getLatestProjectParseJob(projectId)
        : null;

    if (!projectId && !taskId) {
      throw new BadRequestException('Either projectId or taskId is required.');
    }

    if (!job) {
      return {
        status: 'pending',
        progress: 0,
        result: undefined,
      };
    }

    return {
      status: job.status.toLowerCase(),
      progress: job.progress,
      stage: job.currentStage,
      categoryProgress: this.buildCategoryProgress(job),
      result: job.parseResult
        ? {
            parseResultId: job.parseResult.id,
            summary: job.parseResult.summary,
            majorItems: this.groupParseItems(job.parseResult.items),
          }
        : undefined,
    };
  }

  async getParseItemTrace(itemId: string) {
    const item = await this.prisma.parseResultItem.findUnique({
      where: { id: itemId },
      include: {
        parseResult: {
          select: {
            id: true,
            projectId: true,
            documentId: true,
            documentVersionId: true,
            summary: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Parse result item not found.');
    }

    let blockIds = this.toStringArray(item.sourceParagraphIds);
    let chunkIds = this.toStringArray(item.sourceChunkIds);

    if (blockIds.length === 0 || chunkIds.length === 0) {
      const recovered = await this.recoverTraceSources(item.parseResult.documentVersionId, {
        title: item.title,
        content: item.content,
        sourceQuote: item.sourceQuote,
      });
      if (chunkIds.length === 0 && recovered.chunkIds.length > 0) {
        chunkIds = recovered.chunkIds;
      }
      if (blockIds.length === 0 && recovered.blockIds.length > 0) {
        blockIds = recovered.blockIds;
      }

      if (
        (this.toStringArray(item.sourceParagraphIds).length === 0 && blockIds.length > 0) ||
        (this.toStringArray(item.sourceChunkIds).length === 0 && chunkIds.length > 0)
      ) {
        await this.prisma.parseResultItem.update({
          where: { id: item.id },
          data: {
            sourceParagraphIds: blockIds,
            sourceChunkIds: chunkIds,
          },
        });
      }
    }

    let chunks =
      chunkIds.length > 0
        ? await this.prisma.documentChunk.findMany({
            where: { id: { in: chunkIds } },
          })
        : [];

    if (blockIds.length === 0 && chunks.length > 0) {
      blockIds = Array.from(
        new Set(
          chunks.flatMap((chunk) => this.toStringArray(chunk.sourceBlockIds)),
        ),
      );
    }

    let blocks =
      blockIds.length > 0
        ? await this.prisma.documentBlock.findMany({
            where: { id: { in: blockIds } },
            include: { page: true },
          })
        : [];

    if (blocks.length === 0 && chunks.length === 0) {
      const recovered = await this.recoverTraceSources(item.parseResult.documentVersionId, {
        title: item.title,
        content: item.content,
        sourceQuote: item.sourceQuote,
      });
      if (recovered.chunkIds.length > 0) {
        chunks = await this.prisma.documentChunk.findMany({
          where: { id: { in: recovered.chunkIds } },
        });
      }
      if (recovered.blockIds.length > 0) {
        blocks = await this.prisma.documentBlock.findMany({
          where: { id: { in: recovered.blockIds } },
          include: { page: true },
        });
      }
    }

    const orderedBlocks = [...blocks].sort((left, right) => {
      const pageDiff = (left.page?.pageNo ?? 0) - (right.page?.pageNo ?? 0);
      if (pageDiff !== 0) return pageDiff;
      return (left.paragraphNo ?? 0) - (right.paragraphNo ?? 0);
    });

    return {
      item: {
        id: item.id,
        majorCode: item.majorCode,
        minorCode: item.minorCode,
        title: item.title,
        content: item.content,
        sourceQuote: item.sourceQuote,
        parseResultId: item.parseResultId,
        parseSummary: item.parseResult.summary,
      },
      trace: orderedBlocks.map((block) => ({
        blockId: block.id,
        pageNo: block.page?.pageNo ?? null,
        sectionPath: block.sectionPath,
        paragraphNo: block.paragraphNo,
        bbox: block.bbox,
        charStart: block.charStart,
        charEnd: block.charEnd,
        quote: block.text,
        documentVersionId: block.documentVersionId,
      })),
      chunks: chunks.map((chunk) => ({
        chunkId: chunk.id,
        sectionPath: chunk.sectionPath,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        sourceBlockIds: chunk.sourceBlockIds,
        text: chunk.text,
      })),
      parseResult: item.parseResult,
    };
  }

  async getSourceFile(documentVersionId: string) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      include: {
        document: {
          select: {
            documentType: true,
            mimeType: true,
            fileExt: true,
          },
        },
      },
    });

    if (!version) {
      throw new NotFoundException('Tender source document version not found.');
    }

    if (version.document.documentType !== 'TENDER') {
      throw new BadRequestException('Only tender source files can be previewed.');
    }

    const buffer = await this.storage.getObjectBuffer(version.storageBucket, version.storageKey);

    return {
      buffer,
      fileName: version.fileName,
      mimeType: version.document.mimeType || this.guessMimeType(version.document.fileExt, version.fileName),
      fileExt: version.document.fileExt || this.safeExt(version.fileName),
    };
  }

  async generateOutline(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const latestResult = await this.documentService.getLatestProjectParseJob(projectId);
    const parseItems = latestResult?.parseResult?.items ?? [];
    const outlinePromptInput = this.buildOutlinePromptInput(
      project.name,
      latestResult?.parseResult?.summary || project.tenderOutline || '',
      parseItems,
    );
    let outline = normalizeOutlineGroups(await this.ai.generateOutline(projectId, outlinePromptInput || undefined));
    outline = this.attachOutlineSourceMetadata(outline, parseItems);
    outline = this.expandOutlineNodesFromTender(outline, parseItems);

    if (this.needsTechnicalOutlineRefinement(outline, parseItems)) {
      const retryPrompt = [
        outlinePromptInput,
        '补充校正要求：检测到原文存在系统技术要求或同义表达，但当前大纲仍然过于泛化。',
        '请重生成：先总结技术要求要点，再把技术标实质章节展开到三级，并为直接来自原文的节点补上 sourceItemIds。',
      ]
        .filter(Boolean)
        .join('\n\n');
      const retried = normalizeOutlineGroups(await this.ai.generateOutline(projectId, retryPrompt));
      if (retried.length > 0) {
        outline = this.attachOutlineSourceMetadata(retried, parseItems);
        outline = this.expandOutlineNodesFromTender(outline, parseItems);
      }
    }

    const techOutlineSections: OutlineGroup[] = outline.filter(
      (group) =>
        group.group?.includes('\u6280\u672f') ||
        group.group?.toLowerCase().includes('tech') ||
        group.group === '\u6280\u672f\u6807',
    );
    const bizOutlineSections: OutlineGroup[] = outline.filter(
      (group) =>
        group.group?.includes('\u5546\u52a1') ||
        group.group?.toLowerCase().includes('business') ||
        group.group === '\u5546\u52a1\u6807',
    );

    if (techOutlineSections.length === 0) {
      const technicalSource = this.extractTechnicalRequirementPoints(parseItems)[0];
      techOutlineSections.push({
        id: 'group-tech',
        group: '\u6280\u672f\u6807',
        sections: [
          {
            id: 'tech-fallback-1',
            title: technicalSource?.title || '\u539f\u6587\u6280\u672f\u8981\u6c42\u54cd\u5e94',
            detail: technicalSource?.content || '\u56f4\u7ed5\u5f53\u524d\u62db\u6807\u6587\u4ef6\u4e2d\u7684\u6280\u672f\u8981\u6c42\u548c\u670d\u52a1\u8981\u6c42\u8fdb\u884c\u54cd\u5e94\u3002',
            sourceItemIds: technicalSource ? [technicalSource.id] : undefined,
            sourceType: technicalSource ? 'tender' : 'inferred',
            children: [],
          },
        ],
      });
    }
    if (bizOutlineSections.length === 0) {
      const businessSource = this.selectOutlineSourceItems(parseItems).find((item) =>
        /(资格|资质|偏离|承诺|报价|商务)/.test(`${item.title}\n${item.content}`),
      );
      bizOutlineSections.push({
        id: 'group-biz',
        group: '\u5546\u52a1\u6807',
        sections: [
          {
            id: 'biz-fallback-1',
            title: businessSource?.title || '\u5546\u52a1\u54cd\u5e94\u4e0e\u8d44\u683c\u6587\u4ef6',
            detail: businessSource?.content || '\u56f4\u7ed5\u8d44\u683c\u8bc1\u660e\u3001\u5546\u52a1\u627f\u8bfa\u3001\u504f\u79bb\u8868\u548c\u62a5\u4ef7\u6587\u4ef6\u8fdb\u884c\u7ec4\u7ec7\u3002',
            sourceItemIds: businessSource ? [businessSource.id] : undefined,
            sourceType: businessSource ? 'tender' : 'inferred',
            children: [],
          },
        ],
      });
    }

    await this.project.updateOutline(projectId, {
      techOutlineSections,
      bizOutlineSections,
    });

    return {
      success: true,
      outline,
      techOutlineSections,
      bizOutlineSections,
    };
  }

  private buildOutlinePromptInput(projectName: string, tenderSummary: string, parseItems: ParseResultItem[]) {
    const requirementItems = this.selectOutlineSourceItems(parseItems).map((item) => ({
      id: item.id,
      majorCode: item.majorCode,
      minorCode: item.minorCode,
      title: item.title,
      content: this.trimOutlineText(item.content, 240),
      priority: item.priority,
      riskLevel: item.riskLevel,
      sourceQuote: this.trimOutlineText(item.sourceQuote ?? '', 180),
    }));
    const technicalRequirementPoints = this.extractTechnicalRequirementPoints(parseItems).map((item) => ({
      id: item.id,
      title: item.title,
      content: this.trimOutlineText(item.content, 220),
    }));

    return JSON.stringify(
      {
        projectName,
        tenderSummary: this.trimOutlineText(tenderSummary, 2400),
        groupedRequirements: this.groupOutlinePromptItems(requirementItems),
        technicalRequirementPoints,
        referenceHints: REFERENCE_OUTLINE_HINTS,
        hardRules: [
          '当前招标原文决定主结构，参考目录只允许做补盲与校验。',
          '技术标和商务标必须分开，不能串位。',
          '实质性技术章节默认到三级，附件、封面、目录可少于三级。',
          '若原文存在系统技术要求，必须先提炼原文技术要点，再展开技术大纲。',
          '若原文没有展开技术子项，才允许参考访问交互、技术架构、国产化适配、安全设计、备份恢复、高可用、数据质量等方向兜底。',
        ],
      },
      null,
      2,
    );
  }

  private groupOutlinePromptItems(
    items: Array<{
      id: string;
      majorCode: string;
      minorCode: string;
      title: string;
      content: string;
      priority: string | null;
      riskLevel: string;
      sourceQuote: string;
    }>,
  ) {
    const byMajor = new Map<string, typeof items>();
    for (const item of items) {
      const list = byMajor.get(item.majorCode) ?? [];
      list.push(item);
      byMajor.set(item.majorCode, list);
    }

    return Array.from(byMajor.entries()).map(([majorCode, groupItems]) => ({
      majorCode,
      items: groupItems,
    }));
  }

  private selectOutlineSourceItems(parseItems: ParseResultItem[]) {
    return [...parseItems]
      .filter((item) => item.content && item.content !== '未找到')
      .sort((left, right) => this.rankOutlineParseItem(right) - this.rankOutlineParseItem(left))
      .slice(0, 48);
  }

  private rankOutlineParseItem(item: ParseResultItem) {
    let score = 0;
    if (item.isRequired) score += 40;
    if (item.priority === 'high') score += 20;
    if (item.riskLevel === 'high') score += 12;
    if (item.majorCode === 'basic_info') score += this.scoreTechnicalText(`${item.title}\n${item.content}`) > 0 ? 26 : 6;
    if (/(系统功能要求|系统技术要求|技术服务要求|服务要求|实施计划|项目管理方案)/.test(`${item.title}\n${item.content}`)) {
      score += 28;
    }
    score += Math.min(18, Math.floor((item.content?.length ?? 0) / 60));
    return score;
  }

  private extractTechnicalRequirementPoints(parseItems: ParseResultItem[]) {
    return [...parseItems]
      .filter((item) => item.content && item.content !== '未找到')
      .map((item) => ({
        item,
        score: this.scoreTechnicalText(`${item.title}\n${item.content}`),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 16)
      .map((entry) => entry.item);
  }

  private scoreTechnicalText(text: string) {
    const keywords = [
      '系统功能要求',
      '功能要求',
      '业务要求',
      '业务需求',
      '系统技术要求',
      '技术要求',
      '技术服务要求',
      '服务要求',
      '访问交互',
      '技术架构',
      '国产化',
      '安全',
      '备份',
      '高可用',
      '数据质量',
      '审计',
      '实施计划',
      '项目管理方案',
    ];
    return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
  }

  private needsTechnicalOutlineRefinement(outline: OutlineGroup[], parseItems: ParseResultItem[]) {
    if (this.extractTechnicalRequirementPoints(parseItems).length === 0) {
      return false;
    }

    const techGroups = outline.filter((group) => group.group.includes('技术') || group.group.toLowerCase().includes('tech'));
    const maxDepth = this.getMaxOutlineDepth(techGroups.flatMap((group) => group.sections));
    const titles = this.collectOutlineTitles(techGroups.flatMap((group) => group.sections));
    const hasSpecificTechnicalNode = titles.some((title) =>
      /(系统功能要求|业务要求|功能要求|系统技术要求|技术要求|服务要求|实施计划|项目管理|访问交互|架构|国产化|安全|备份|高可用|数据质量)/.test(
        title,
      ),
    );
    const hasGenericTechnicalNode = titles.some((title) => /技术方案/.test(title));

    return maxDepth < 3 || (!hasSpecificTechnicalNode && hasGenericTechnicalNode);
  }

  private expandOutlineNodesFromTender(outline: OutlineGroup[], parseItems: ParseResultItem[]) {
    const parseItemMap = new Map(parseItems.map((item) => [item.id, item] as const));
    return outline.map((group) => ({
      ...group,
      sections: group.sections.map((node) => this.expandOutlineNodeFromTender(node, parseItemMap, 1)),
    }));
  }

  private expandOutlineNodeFromTender(
    node: OutlineGroup['sections'][number],
    parseItemMap: Map<string, ParseResultItem>,
    level: number,
  ): OutlineGroup['sections'][number] {
    const children = node.children.map((child) => this.expandOutlineNodeFromTender(child, parseItemMap, level + 1));
    if (children.length > 0 || level >= 3) {
      return {
        ...node,
        children,
      };
    }

    const matchedTopics = this.collectOutlineExpansionTopics(node, parseItemMap);
    if (matchedTopics.length < 2) {
      return {
        ...node,
        children,
      };
    }

    return {
      ...node,
      children: matchedTopics.slice(0, 8).map((topic, index) => ({
        id: `${node.id}_auto_${index + 1}`,
        title: topic.title,
        detail: topic.detail,
        sourceItemIds: node.sourceItemIds,
        sourceType: node.sourceItemIds?.length ? 'inferred' : node.sourceType,
        children: [],
      })),
    };
  }

  private collectOutlineExpansionTopics(
    node: OutlineGroup['sections'][number],
    parseItemMap: Map<string, ParseResultItem>,
  ) {
    const sourceText = (node.sourceItemIds ?? [])
      .map((id) => parseItemMap.get(id))
      .filter((item): item is ParseResultItem => Boolean(item))
      .map((item) => `${item.title}\n${item.content}`)
      .join('\n');
    const nodeText = `${node.title}\n${node.detail ?? ''}`;
    const combinedText = `${nodeText}\n${sourceText}`;
    const rules: Array<{
      when: RegExp;
      topics: Array<{ title: string; detail: string; aliases: string[] }>;
    }> = [
      {
        when: /(系统技术要求|技术要求|技术方案|技术响应|总体技术)/,
        topics: [
          { title: '访问交互', detail: '逐条响应访问界面友好性、交互体验与易用性要求。', aliases: ['访问交互', '访问界面友好', '界面友好', '交互'] },
          { title: '技术架构', detail: '说明技术架构、部署架构、模块划分与关键技术路线。', aliases: ['技术架构', '架构', '架构说明', '部署架构'] },
          { title: '国产化适配', detail: '说明对国产基础软件、信创环境与兼容适配的响应方案。', aliases: ['国产', '信创', '适配国产', '基础软件环境'] },
          { title: '安全设计', detail: '说明系统安全、权限控制、审计留痕与安全防护设计。', aliases: ['安全', '安全设计', '权限', '审计'] },
          { title: '备份恢复', detail: '说明数据备份、恢复机制与容灾方案。', aliases: ['备份', '恢复', '容灾'] },
          { title: '高可用', detail: '说明高可用、稳定性、故障切换与连续服务能力。', aliases: ['高可用', '稳定性', '故障切换'] },
          { title: '数据质量', detail: '说明数据质量控制、加工校验与结果一致性保障。', aliases: ['数据质量', '数据加工', '校验'] },
        ],
      },
      {
        when: /(服务要求|项目管理|实施计划|实施方案|开发方法|测试方法|配置管理|培训|运维|故障处理|响应速度|支持承诺)/,
        topics: [
          { title: '项目管理方案', detail: '说明项目组织、管理机制、沟通汇报与风险控制方案。', aliases: ['项目管理', '管理方案', '服务方法'] },
          { title: '实施计划', detail: '说明实施阶段安排、排期时间、里程碑和实施周期。', aliases: ['实施计划', '排期', '实施周期', '时间节点'] },
          { title: '开发方法', detail: '说明开发流程、质量控制与交付方式。', aliases: ['开发方法', '开发流程'] },
          { title: '测试方法', detail: '说明测试策略、测试组织、测试环境与验收配合。', aliases: ['测试方法', '测试策略', '测试'] },
          { title: '配置管理', detail: '说明配置管理、版本管理与变更控制机制。', aliases: ['配置管理', '版本管理', '变更管理'] },
          { title: '技术转移', detail: '说明技术转移、知识交接与文档移交安排。', aliases: ['技术转移', '知识转移', '交接'] },
          { title: '培训方案', detail: '说明培训对象、培训内容、培训方式与培训计划。', aliases: ['培训', '培训方案'] },
          { title: '运维保障', detail: '说明运维保修、故障处理、响应速度和支持承诺。', aliases: ['运维', '保修', '故障处理', '响应速度', '支持承诺'] },
        ],
      },
      {
        when: /(团队|成员配置|人员配置|岗位职责|工作分工)/,
        topics: [
          { title: '项目经理', detail: '说明项目经理的职责分工、资历与项目管理经验。', aliases: ['项目经理'] },
          { title: '需求分析师', detail: '说明需求分析岗位的职责与相关实施经验。', aliases: ['需求分析', '需求分析师'] },
          { title: '系统架构师', detail: '说明系统架构岗位的职责与架构设计经验。', aliases: ['系统架构', '架构师'] },
          { title: '开发人员', detail: '说明开发岗位配置、职责与项目经验。', aliases: ['开发'] },
          { title: '测试人员', detail: '说明测试岗位配置、职责与测试经验。', aliases: ['测试'] },
          { title: '实施人员', detail: '说明实施岗位配置、职责与项目经验。', aliases: ['实施'] },
        ],
      },
      {
        when: /(关键里程碑|时间节点|进度计划|阶段安排|工作分工|实施周期)/,
        topics: [
          { title: '阶段划分', detail: '说明项目实施阶段划分及各阶段工作目标。', aliases: ['阶段', '阶段计划', '阶段安排'] },
          { title: '关键里程碑', detail: '说明关键里程碑节点及对应交付成果。', aliases: ['里程碑', '关键节点'] },
          { title: '时间计划', detail: '说明整体排期、各阶段持续时间与完成时限。', aliases: ['时间', '排期', '周期'] },
          { title: '工作分工', detail: '说明各阶段参与角色与职责分工。', aliases: ['分工', '职责'] },
        ],
      },
    ];

    const matchedRule = rules.find((rule) => rule.when.test(nodeText));
    if (!matchedRule) {
      return [];
    }

    return matchedRule.topics.filter((topic) => topic.aliases.some((alias) => combinedText.includes(alias)));
  }

  private getMaxOutlineDepth(
    nodes: Array<{
      children?: unknown;
    }>,
    depth = 1,
  ): number {
    if (nodes.length === 0) {
      return 0;
    }

    return nodes.reduce((maxDepth, node) => {
      const children = Array.isArray(node.children) ? node.children : [];
      return Math.max(maxDepth, children.length > 0 ? this.getMaxOutlineDepth(children, depth + 1) : depth);
    }, depth);
  }

  private collectOutlineTitles(
    nodes: Array<{
      title?: string;
      children?: unknown;
    }>,
  ): string[] {
    return nodes.flatMap((node) => {
      const children = Array.isArray(node.children) ? node.children : [];
      return [node.title ?? '', ...this.collectOutlineTitles(children)].filter(Boolean);
    });
  }

  private attachOutlineSourceMetadata(outline: OutlineGroup[], parseItems: ParseResultItem[]) {
    return outline.map((group) => ({
      ...group,
      sections: group.sections.map((node) => this.attachOutlineNodeSource(node, parseItems, [group.group])),
    }));
  }

  private attachOutlineNodeSource(
    node: OutlineGroup['sections'][number],
    parseItems: ParseResultItem[],
    pathTitles: string[],
  ): OutlineGroup['sections'][number] {
    const childPath = [...pathTitles, node.title];
    const validSourceIds = Array.from(
      new Set((node.sourceItemIds ?? []).filter((id) => parseItems.some((item) => item.id === id))),
    );
    const matchedSourceIds = validSourceIds.length > 0 ? validSourceIds : this.matchOutlineNodeSourceIds(node, parseItems, childPath);

    return {
      ...node,
      sourceItemIds: matchedSourceIds.length > 0 ? matchedSourceIds : undefined,
      sourceType:
        matchedSourceIds.length > 0
          ? 'tender'
          : node.sourceType === 'reference'
            ? 'reference'
            : this.isReferenceLikeNode(node)
              ? 'reference'
              : 'inferred',
      children: node.children.map((child) => this.attachOutlineNodeSource(child, parseItems, childPath)),
    };
  }

  private matchOutlineNodeSourceIds(
    node: { title: string; detail?: string },
    parseItems: ParseResultItem[],
    pathTitles: string[],
  ) {
    const nodeText = [...pathTitles, node.title, node.detail ?? ''].filter(Boolean).join('\n');
    return parseItems
      .map((item) => ({
        id: item.id,
        score: this.scoreOutlineNodeMatch(nodeText, item),
      }))
      .filter((entry) => entry.score >= 26)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((entry) => entry.id);
  }

  private scoreOutlineNodeMatch(nodeText: string, item: ParseResultItem) {
    if (!item.content || item.content === '未找到') {
      return 0;
    }

    const normalizedNode = this.normalizeTraceText(nodeText);
    const normalizedTitle = this.normalizeTraceText(item.title);
    const normalizedContent = this.normalizeTraceText(item.content);
    let score = 0;

    if (normalizedTitle && (normalizedNode.includes(normalizedTitle) || normalizedTitle.includes(normalizedNode))) {
      score += 100;
    }

    if (normalizedContent && normalizedNode && (normalizedContent.includes(normalizedNode) || normalizedNode.includes(normalizedContent))) {
      score += 48;
    }

    const keywords = this.extractOutlineKeywords(nodeText);
    score += keywords.filter((keyword) => item.title.includes(keyword) || item.content.includes(keyword)).length * 16;
    score += this.scoreTechnicalText(`${nodeText}\n${item.title}\n${item.content}`) * 8;
    return score;
  }

  private extractOutlineKeywords(text: string) {
    return Array.from(
      new Set(
        [
          '系统功能要求',
          '业务要求',
          '功能要求',
          '系统技术要求',
          '技术要求',
          '技术服务要求',
          '服务要求',
          '实施计划',
          '项目管理方案',
          '访问交互',
          '技术架构',
          '国产化',
          '安全',
          '备份',
          '高可用',
          '数据质量',
          '资质',
          '偏离表',
          '承诺',
          '报价',
        ].filter((keyword) => text.includes(keyword)),
      ),
    );
  }

  private isReferenceLikeNode(node: { title: string; detail?: string }) {
    return /建议|可补充|可选/.test(`${node.title}\n${node.detail ?? ''}`);
  }

  private trimOutlineText(value: string | null | undefined, maxLength: number) {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return '';
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }

  private safeFileName(fileName: string) {
    return fileName.replace(/[^\w.-]+/g, '_');
  }

  private safeExt(fileName?: string | null) {
    const ext = fileName?.split('.').pop()?.trim().toLowerCase();
    return ext || '';
  }

  private guessMimeType(fileExt?: string | null, fileName?: string | null) {
    const normalizedExt = (fileExt || this.safeExt(fileName)).replace(/^\./, '').toLowerCase();
    switch (normalizedExt) {
      case 'pdf':
        return 'application/pdf';
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'doc':
        return 'application/msword';
      case 'txt':
        return 'text/plain; charset=utf-8';
      default:
        return 'application/octet-stream';
    }
  }

  private groupParseItems(items: ParseResultItem[]) {
    return TENDER_PARSE_CATALOG.map((catalog) => ({
      majorCode: catalog.majorCode,
      majorName: catalog.title,
      items: items
        .filter((item) => item.majorCode === catalog.majorCode)
        .map((item) => ({
          id: item.id,
          minorCode: item.minorCode,
          title: item.title,
          content: item.content,
          confidence: item.confidence,
          priority: item.priority,
          isRequired: item.isRequired,
          riskLevel: item.riskLevel,
          sourceParagraphIds: item.sourceParagraphIds,
          sourceChunkIds: item.sourceChunkIds,
          sourceQuote: item.sourceQuote,
          normalizedValue: item.normalizedValue,
        })),
    }));
  }

  private toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }

  private normalizeTraceText(value?: string | null) {
    return (value ?? '').replace(/\s+/g, '').trim();
  }

  private scoreTraceCandidate(candidate: string, targets: string[]) {
    const normalizedCandidate = this.normalizeTraceText(candidate);
    if (!normalizedCandidate) {
      return 0;
    }

    let bestScore = 0;
    for (const target of targets) {
      if (!target) {
        continue;
      }

      if (normalizedCandidate === target) {
        return 1000;
      }
      if (normalizedCandidate.includes(target)) {
        bestScore = Math.max(bestScore, 800 + Math.min(target.length, 200));
        continue;
      }
      if (target.includes(normalizedCandidate) && normalizedCandidate.length >= 12) {
        bestScore = Math.max(bestScore, 500 + Math.min(normalizedCandidate.length, 120));
        continue;
      }

      const prefixLength = Math.min(normalizedCandidate.length, target.length, 80);
      let overlap = 0;
      for (let index = 0; index < prefixLength; index += 1) {
        if (normalizedCandidate[index] === target[index]) {
          overlap += 1;
        }
      }
      bestScore = Math.max(bestScore, (overlap / Math.max(prefixLength, 1)) * 100);
    }

    return bestScore;
  }

  private async recoverTraceSources(
    documentVersionId: string,
    item: { title: string; content: string; sourceQuote?: string | null },
  ) {
    const targets = Array.from(
      new Set(
        [item.sourceQuote, item.content, item.title]
          .map((value) => this.normalizeTraceText(value))
          .filter((value) => value.length >= 8),
      ),
    );

    if (targets.length === 0) {
      return { blockIds: [] as string[], chunkIds: [] as string[] };
    }

    const candidateChunks = await this.prisma.documentChunk.findMany({
      where: { documentVersionId },
      select: {
        id: true,
        text: true,
        sourceBlockIds: true,
      },
    });

    const scoredChunks = candidateChunks
      .map((chunk) => ({
        id: chunk.id,
        score: this.scoreTraceCandidate(chunk.text, targets),
        sourceBlockIds: this.toStringArray(chunk.sourceBlockIds),
      }))
      .filter((chunk) => chunk.score >= 24)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    const chunkIds = scoredChunks.map((chunk) => chunk.id);
    const blockIdsFromChunks = Array.from(
      new Set(scoredChunks.flatMap((chunk) => chunk.sourceBlockIds)),
    );

    if (blockIdsFromChunks.length > 0 || chunkIds.length > 0) {
      return {
        blockIds: blockIdsFromChunks,
        chunkIds,
      };
    }

    const candidateBlocks = await this.prisma.documentBlock.findMany({
      where: { documentVersionId },
      select: {
        id: true,
        text: true,
      },
    });

    const blockIds = candidateBlocks
      .map((block) => ({
        id: block.id,
        score: this.scoreTraceCandidate(block.text, targets),
      }))
      .filter((block) => block.score >= 24)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((block) => block.id);

    return {
      blockIds,
      chunkIds: [],
    };
  }

  private buildCategoryProgress(job: Awaited<ReturnType<DocumentService['getParseJobWithResult']>>) {
    const itemCountByMajor = new Map<string, number>();
    for (const item of job?.parseResult?.items ?? []) {
      itemCountByMajor.set(item.majorCode, (itemCountByMajor.get(item.majorCode) ?? 0) + 1);
    }

    const orderedCategories = TENDER_STRUCTURED_SCHEMA.map((category) => ({
      majorCode: category.majorCode,
      key: category.key,
      label: category.label,
      itemCount: itemCountByMajor.get(category.majorCode) ?? 0,
    }));

    const completedCount = orderedCategories.filter((category) => category.itemCount > 0).length;
    const activeIndex =
      (job?.status === ParseJobStatus.RUNNING || job?.status === ParseJobStatus.FAILED) &&
      job?.currentStage === ParseJobStage.LLM_EXTRACT &&
      completedCount < orderedCategories.length
        ? completedCount
        : -1;

    return orderedCategories.map((category, index) => {
      let status: 'pending' | 'running' | 'completed' | 'failed' = 'pending';

      if (job?.status === ParseJobStatus.SUCCEEDED || index < completedCount) {
        status = 'completed';
      }

      if (job?.status === ParseJobStatus.RUNNING && index === activeIndex) {
        status = 'running';
      }

      if (job?.status === ParseJobStatus.FAILED && index === activeIndex) {
        status = 'failed';
      }

      return {
        ...category,
        status,
      };
    });
  }
}
