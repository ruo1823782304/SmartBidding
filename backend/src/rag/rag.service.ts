import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import {
  BuildParseResultOptions,
  ChunkDraft,
  ParseResultDraft,
  ParseResultItemDraft,
  PersistedBlockRef,
  PersistedChunkRef,
} from './rag.types';
import {
  TENDER_STRUCTURED_SCHEMA,
  TenderCategoryDefinition,
  TenderScalarFieldDefinition,
  TenderSubTabDefinition,
} from './tender-structured.schema';

const UNRESOLVED_VALUE = '未找到';

type RuleExtractedField = {
  fieldKey: string;
  value: string;
  confidence: number;
  sourceChunkIds: string[];
  sourceParagraphIds: string[];
  sourceQuote?: string;
  extractionMethod: 'rule';
  validationNotes?: string;
};

type LlmFieldResult = {
  fieldKey: string;
  value?: string;
  confidence?: number;
  sourceChunkIds?: string[];
  sourceQuote?: string;
  validationNotes?: string;
};

type LlmListItem = {
  title?: string;
  content?: string;
  confidence?: number;
  sourceChunkIds?: string[];
  sourceQuote?: string;
  validationNotes?: string;
};

type ExtractedListItem = {
  title: string;
  content: string;
  confidence: number;
  sourceChunkIds: string[];
  sourceParagraphIds: string[];
  sourceQuote?: string;
  extractionMethod: 'rule' | 'llm' | 'rule+llm';
  validationNotes?: string;
};

type ChosenScalarField = {
  value: string;
  confidence: number;
  sourceChunkIds: string[];
  sourceParagraphIds: string[];
  sourceQuote?: string;
  extractionMethod: 'rule' | 'llm' | 'rule+llm';
  validationNotes?: string;
};

@Injectable()
export class RagService {
  constructor(private readonly ai: AiService) {}

  buildChunks(blocks: PersistedBlockRef[]): ChunkDraft[] {
    const chunks: ChunkDraft[] = [];
    let currentBuffer: PersistedBlockRef[] = [];

    const flush = () => {
      if (currentBuffer.length === 0) return;
      const text = currentBuffer.map((item) => item.text).join('\n');
      const sectionPath = currentBuffer[currentBuffer.length - 1]?.sectionPath;
      const pageNumbers = currentBuffer.map((item) => item.pageNo);
      const blockTypes = currentBuffer.map((item) => item.blockType);
      chunks.push({
        chunkType: this.inferChunkType(text, blockTypes),
        sourceBlockIds: currentBuffer.map((item) => item.id),
        sectionPath,
        pageStart: Math.min(...pageNumbers),
        pageEnd: Math.max(...pageNumbers),
        text,
        textForEmbedding: text,
        keywords: this.extractKeywords(`${sectionPath ?? ''}\n${text}`),
        importanceScore: this.calculateImportanceScore(text, sectionPath, blockTypes),
      });
      currentBuffer = [];
    };

    for (const block of blocks) {
      const isHeading = block.blockType === 'HEADING' || block.blockType === 'TITLE';
      const isStandalone = this.isStandaloneRequirementBlock(block);
      const lastSectionPath = currentBuffer[currentBuffer.length - 1]?.sectionPath;
      const sectionChanged =
        currentBuffer.length > 0 &&
        Boolean(block.sectionPath) &&
        Boolean(lastSectionPath) &&
        block.sectionPath !== lastSectionPath;

      if (isHeading) {
        flush();
        currentBuffer.push(block);
        continue;
      }

      if (sectionChanged) {
        flush();
      }

      if (isStandalone) {
        flush();
        currentBuffer.push(block);
        flush();
        continue;
      }

      currentBuffer.push(block);
      const currentLength = currentBuffer.reduce((sum, item) => sum + item.text.length, 0);
      if (currentLength >= 650) {
        flush();
      }
    }

    flush();
    return chunks;
  }

  async buildParseResult(chunks: PersistedChunkRef[], options?: BuildParseResultOptions): Promise<ParseResultDraft> {
    const items: ParseResultItemDraft[] = [];
    const provider = await this.ai.getTaskProvider('tenderParse');
    let llmUsed = false;
    const summary = chunks
      .slice(0, 3)
      .map((chunk) => this.trimText(chunk.text, 120))
      .join(' ');

    for (const [categoryIndex, category] of TENDER_STRUCTURED_SCHEMA.entries()) {
      const subtabResults = await Promise.all(
        category.subtabs.map(async (subtab) => {
          const candidateChunks = this.pickCandidateChunks(
            chunks,
            [...subtab.keywords, category.label],
            subtab.mode === 'scalar' ? 12 : 6,
          );
          if (subtab.mode === 'scalar' && subtab.fields) {
            const scalarItems = await this.buildScalarItems(category, subtab, candidateChunks);
            return { items: scalarItems, llmUsed: scalarItems.some((item) => item.normalizedValue?.extractionMethod !== 'rule') };
          }

          const listItems = await this.buildListItems(category, subtab, candidateChunks);
          return { items: listItems, llmUsed: listItems.some((item) => item.normalizedValue?.extractionMethod !== 'rule') };
        }),
      );

      for (const result of subtabResults) {
        if (result.llmUsed) {
          llmUsed = true;
        }
        items.push(...result.items);
      }

      await options?.onCategoryComplete?.({
        ...this.composeParseResultDraft(summary, items, provider, llmUsed),
        latestMajorCode: category.majorCode,
        completedCategories: categoryIndex + 1,
        totalCategories: TENDER_STRUCTURED_SCHEMA.length,
      });
    }

    return this.composeParseResultDraft(summary, items, provider, llmUsed);
  }

  private async buildScalarItems(
    category: TenderCategoryDefinition,
    subtab: TenderSubTabDefinition,
    chunks: PersistedChunkRef[],
  ): Promise<ParseResultItemDraft[]> {
    const ruleFields = new Map<string, RuleExtractedField>();

    for (const field of subtab.fields ?? []) {
      const extracted = this.extractScalarField(field, chunks);
      if (extracted) {
        ruleFields.set(field.key, extracted);
      }
    }

    const missingFields = (subtab.fields ?? []).filter((field) => !ruleFields.has(field.key));
    const llmFields =
      chunks.length > 0 && missingFields.length > 0
        ? await this.extractScalarFieldsWithLlm(category, subtab, chunks, missingFields).catch(() => null)
        : null;
    const llmFieldMap = new Map<string, LlmFieldResult>((llmFields ?? []).map((field) => [field.fieldKey, field]));

    return (subtab.fields ?? []).map((field) => {
      const chosen = this.mergeScalarFieldResult(
        field,
        ruleFields.get(field.key),
        llmFieldMap.get(field.key),
        chunks,
      );
      const missingValue = chosen.value === UNRESOLVED_VALUE;
      const riskLevel: ParseResultItemDraft['riskLevel'] = missingValue ? 'medium' : 'low';

      return {
        majorCode: category.majorCode,
        minorCode: `${subtab.key}_${field.key}`,
        title: field.label,
        content: chosen.value,
        normalizedValue: {
          majorKey: category.key,
          subTabKey: subtab.key,
          fieldKey: field.key,
          displayLabel: field.label,
          fieldType: 'scalar',
          extractionMethod: chosen.extractionMethod,
          validationNotes: chosen.validationNotes,
        },
        confidence: chosen.confidence,
        priority: missingValue ? 'medium' : 'high',
        isRequired: true,
        riskLevel,
        sourceParagraphIds: chosen.sourceParagraphIds,
        sourceChunkIds: chosen.sourceChunkIds,
        sourceQuote: chosen.sourceQuote,
      };
    });
  }

  private async buildListItems(
    category: TenderCategoryDefinition,
    subtab: TenderSubTabDefinition,
    chunks: PersistedChunkRef[],
  ): Promise<ParseResultItemDraft[]> {
    const ruleItems = this.extractListItemsByRules(category, subtab, chunks);
    const shouldUseLlm = this.shouldSupplementListItems(chunks, [...subtab.keywords, category.label], ruleItems);
    const llmItems =
      chunks.length > 0 && shouldUseLlm
        ? await this.extractListItemsWithLlm(category, subtab, chunks).catch(() => null)
        : null;
    const mergedItems: ExtractedListItem[] = [...ruleItems];

    for (const llmItem of llmItems ?? []) {
      const normalizedTitle = this.normalizeText(llmItem.title);
      if (!normalizedTitle) continue;
      if (mergedItems.some((item) => this.normalizeText(item.title) === normalizedTitle)) {
        continue;
      }

      const resolvedChunkIds = (llmItem.sourceChunkIds ?? []).filter((chunkId: string) =>
        chunks.some((chunk) => chunk.id === chunkId),
      );
      const resolvedChunks = chunks.filter((chunk) => resolvedChunkIds.includes(chunk.id));
      mergedItems.push({
        title: llmItem.title?.trim() ?? subtab.label,
        content: this.sanitizeValue(llmItem.content),
        confidence: this.normalizeConfidence(llmItem.confidence, 0.72),
        sourceChunkIds: resolvedChunkIds,
        sourceParagraphIds: resolvedChunks.flatMap((chunk) => chunk.sourceBlockIds),
        sourceQuote: llmItem.sourceQuote ?? resolvedChunks[0]?.text,
        extractionMethod: 'llm',
        validationNotes: llmItem.validationNotes ?? '',
      });
    }

    const fallbackItems: ExtractedListItem[] =
      mergedItems.length > 0
        ? mergedItems
        : [
            {
              title: subtab.label,
              content: UNRESOLVED_VALUE,
              confidence: 0.2,
              sourceChunkIds: [],
              sourceParagraphIds: [],
              sourceQuote: undefined,
              extractionMethod: 'rule',
              validationNotes: 'No matching chunk found.',
            },
          ];

    return fallbackItems.map((item, index) => {
      const riskLevel: ParseResultItemDraft['riskLevel'] =
        category.key === 'invalid' || category.key === 'clause'
          ? 'high'
          : item.content === UNRESOLVED_VALUE
            ? 'medium'
            : 'low';

      return {
        majorCode: category.majorCode,
        minorCode: `${subtab.key}_item_${index + 1}`,
        title: item.title,
        content: item.content,
        normalizedValue: {
          majorKey: category.key,
          subTabKey: subtab.key,
          fieldKey: `item_${index + 1}`,
          displayLabel: item.title,
          fieldType: 'list-item',
          extractionMethod: item.extractionMethod,
          validationNotes: item.validationNotes,
        },
        confidence: item.confidence,
        priority: index === 0 ? 'high' : 'medium',
        isRequired: category.key !== 'clause',
        riskLevel,
        sourceParagraphIds: item.sourceParagraphIds,
        sourceChunkIds: item.sourceChunkIds,
        sourceQuote: item.sourceQuote,
      };
    });
  }

  private extractScalarField(field: TenderScalarFieldDefinition, chunks: PersistedChunkRef[]): RuleExtractedField | null {
    const candidateChunks = this.pickCandidateChunks(chunks, field.keywords, Math.min(8, Math.max(3, chunks.length)));
    const bestChunk = candidateChunks[0];
    for (const chunk of candidateChunks) {
      const extracted = this.extractScalarFieldFromChunk(field, chunk);
      if (extracted) {
        return extracted;
      }
    }

    return null;

    for (const keyword of field.keywords) {
      const regex = new RegExp(`${this.escapeRegExp(keyword)}\\s*[：:]\\s*([^\\n：:]+)`, 'i');
      const matched = bestChunk.text.match(regex);
      if (matched?.[1]) {
        return {
          fieldKey: field.key,
          value: this.sanitizeValue(matched?.[1]),
          confidence: 0.74,
          sourceChunkIds: [bestChunk.id],
          sourceParagraphIds: bestChunk.sourceBlockIds,
          sourceQuote: matched?.[0],
          extractionMethod: 'rule',
        };
      }
    }

    return null;
  }

  private extractScalarFieldFromChunk(
    field: TenderScalarFieldDefinition,
    chunk: PersistedChunkRef,
  ): RuleExtractedField | null {
    const normalizedText = chunk.text.replace(/\r/g, '');
    const lines = normalizedText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const patternCandidates = [normalizedText, ...lines];
    for (const candidate of patternCandidates) {
      for (const pattern of field.patterns ?? []) {
        const matched = candidate.match(pattern);
        const extracted = this.buildRuleField(field, chunk, matched?.[1], matched?.[0], 0.82);
        if (extracted) {
          return extracted;
        }
      }
    }

    for (const keyword of field.keywords) {
      const sameLineMatch = normalizedText.match(
        new RegExp(`${this.escapeRegExp(keyword)}\\s*[:：]\\s*([^\\n:：]+)`, 'i'),
      );
      const sameLineExtracted = this.buildRuleField(field, chunk, sameLineMatch?.[1], sameLineMatch?.[0], 0.78);
      if (sameLineExtracted) {
        return sameLineExtracted;
      }

      const nextLineMatch = normalizedText.match(
        new RegExp(`${this.escapeRegExp(keyword)}\\s*[:：]?\\s*\\n\\s*([^\\n]+)`, 'i'),
      );
      const nextLineExtracted = this.buildRuleField(field, chunk, nextLineMatch?.[1], nextLineMatch?.[0], 0.76);
      if (nextLineExtracted) {
        return nextLineExtracted;
      }

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!this.isLabelLine(line, keyword)) {
          continue;
        }

        const inlineValue = line
          .replace(new RegExp(`.*${this.escapeRegExp(keyword)}\\s*[:：]?\\s*`, 'i'), '')
          .trim();
        const inlineExtracted = this.buildRuleField(field, chunk, inlineValue, line, 0.74);
        if (inlineExtracted) {
          return inlineExtracted;
        }

        const nextLine = lines[index + 1];
        const nextLineExtracted = this.buildRuleField(field, chunk, nextLine, `${line}\n${nextLine}`, 0.72);
        if (nextLineExtracted) {
          return nextLineExtracted;
        }
      }
    }

    const heuristic = this.extractScalarFieldByHeuristics(field, lines);
    if (heuristic) {
      return this.buildRuleField(field, chunk, heuristic, heuristic, 0.68);
    }

    return null;
  }

  private buildRuleField(
    field: TenderScalarFieldDefinition,
    chunk: PersistedChunkRef,
    rawValue: string | null | undefined,
    sourceQuote: string | null | undefined,
    confidence: number,
  ): RuleExtractedField | null {
    const value = this.sanitizeValue(rawValue);
    if (value === UNRESOLVED_VALUE || this.isInvalidScalarValue(field, value)) {
      return null;
    }

    return {
      fieldKey: field.key,
      value,
      confidence,
      sourceChunkIds: [chunk.id],
      sourceParagraphIds: chunk.sourceBlockIds,
      sourceQuote: sourceQuote ?? value,
      extractionMethod: 'rule',
    };
  }

  private extractScalarFieldByHeuristics(field: TenderScalarFieldDefinition, lines: string[]) {
    if (field.key === 'tender_name' || field.key === 'contact_name') {
      const organizationLine = lines.find((line) => this.looksLikeOrganizationName(line));
      if (organizationLine) {
        return organizationLine;
      }
    }

    if (field.key === 'contact_website') {
      return lines.find((line) => /(https?:\/\/|www\.)/i.test(line)) ?? null;
    }

    if (field.key === 'email') {
      return (
        lines
          .map((line) => line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '')
          .find(Boolean) ?? null
      );
    }

    return null;
  }

  private mergeScalarFieldResult(
    field: TenderScalarFieldDefinition,
    rule: RuleExtractedField | undefined,
    llm: LlmFieldResult | undefined,
    chunks: PersistedChunkRef[],
  ): ChosenScalarField {
    const llmResolvedChunks = chunks.filter((chunk) => (llm?.sourceChunkIds ?? []).includes(chunk.id));
    const llmValue = this.sanitizeValue(llm?.value);
    const llmConfidence = this.normalizeConfidence(llm?.confidence, 0.68);

    if (!rule && llmValue !== UNRESOLVED_VALUE) {
      return {
        value: llmValue,
        confidence: llmConfidence,
        sourceChunkIds: llmResolvedChunks.map((chunk) => chunk.id),
        sourceParagraphIds: llmResolvedChunks.flatMap((chunk) => chunk.sourceBlockIds),
        sourceQuote: llm?.sourceQuote ?? llmResolvedChunks[0]?.text,
        extractionMethod: 'llm',
        validationNotes: llm?.validationNotes ?? '',
      };
    }

    if (rule && llmValue !== UNRESOLVED_VALUE && llmValue !== rule.value) {
      if (llmConfidence > rule.confidence + 0.08) {
        return {
          value: llmValue,
          confidence: llmConfidence,
          sourceChunkIds: llmResolvedChunks.map((chunk) => chunk.id),
          sourceParagraphIds: llmResolvedChunks.flatMap((chunk) => chunk.sourceBlockIds),
          sourceQuote: llm?.sourceQuote ?? llmResolvedChunks[0]?.text,
          extractionMethod: 'rule+llm',
          validationNotes: llm?.validationNotes ?? `Rule extracted "${rule.value}", LLM corrected to "${llmValue}".`,
        };
      }
      return {
        ...rule,
        extractionMethod: 'rule+llm',
        validationNotes: llm?.validationNotes ?? `LLM suggested "${llmValue}", rule kept "${rule.value}".`,
      };
    }

    if (rule && llmValue !== UNRESOLVED_VALUE && llmValue === rule.value) {
      return {
        ...rule,
        confidence: Number(Math.min(0.98, Math.max(rule.confidence, llmConfidence) + 0.05).toFixed(2)),
        extractionMethod: 'rule+llm',
        validationNotes: llm?.validationNotes,
      };
    }

    if (rule) {
      return {
        ...rule,
        extractionMethod: 'rule',
        validationNotes: llm?.validationNotes,
      };
    }

    return {
      value: UNRESOLVED_VALUE,
      confidence: 0.2,
      sourceChunkIds: [],
      sourceParagraphIds: [],
      sourceQuote: undefined,
      extractionMethod: 'llm',
      validationNotes: llm?.validationNotes ?? `No value extracted for ${field.label}.`,
    };
  }

  private extractListItemsByRules(
    category: TenderCategoryDefinition,
    subtab: TenderSubTabDefinition,
    chunks: PersistedChunkRef[],
  ): ExtractedListItem[] {
    const extracted: ExtractedListItem[] = [];
    const candidateChunks = this.pickCandidateChunks(chunks, [...subtab.keywords, category.label], 6);

    candidateChunks.forEach((chunk, chunkIndex) => {
      const segments = this.extractStructuredSegments(chunk.text);
      const segmentSource = segments.length > 1 ? segments : [chunk.text];

      segmentSource.forEach((segment, segmentIndex) => {
        const cleaned = this.cleanRequirementSegment(segment);
        if (!cleaned) {
          return;
        }

        extracted.push({
          title: this.extractListItemTitle(cleaned, subtab.label, extracted.length || chunkIndex + segmentIndex),
          content: this.trimText(cleaned, 320),
          confidence: Number((0.66 + Math.max(0, 0.08 - chunkIndex * 0.02)).toFixed(2)),
          sourceChunkIds: [chunk.id],
          sourceParagraphIds: chunk.sourceBlockIds,
          sourceQuote: this.trimText(cleaned, 180),
          extractionMethod: 'rule',
          validationNotes: segments.length > 1 ? 'Split from structured clause list.' : '',
        });
      });
    });

    return this.dedupeListItems(extracted).slice(0, 10);
  }

  private async extractScalarFieldsWithLlm(
    category: TenderCategoryDefinition,
    subtab: TenderSubTabDefinition,
    chunks: PersistedChunkRef[],
    fields: TenderScalarFieldDefinition[],
  ): Promise<LlmFieldResult[] | null> {
    const response = await this.ai.chatJson<{ fields?: LlmFieldResult[] }>({
      task: 'tenderParse',
      systemPrompt: [
        'You extract scalar tender fields from source chunks.',
        'Return JSON only.',
        'Schema: {"fields":[{"fieldKey":"key","value":"value","confidence":0.0,"sourceChunkIds":["chunk-id"],"sourceQuote":"quote","validationNotes":"optional"}]}',
        `When a field cannot be confirmed, return "${UNRESOLVED_VALUE}".`,
        'sourceChunkIds must come from the provided chunk ids.',
        'Field values may appear on the next line after a label.',
        'Prefer exact values from source chunks and do not invent missing fields.',
      ].join('\n'),
      userContent: JSON.stringify({
        category: category.label,
        subTab: subtab.label,
        fields: fields.map((entry) => ({
          fieldKey: entry.key,
          label: entry.label,
          keywords: entry.keywords,
        })),
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          sectionPath: chunk.sectionPath,
          text: this.trimText(chunk.text, 1200),
        })),
      }),
      temperature: 0.1,
      maxTokens: 1800,
    });
    return response?.fields ?? null;
  }

  private async extractListItemsWithLlm(
    category: TenderCategoryDefinition,
    subtab: TenderSubTabDefinition,
    chunks: PersistedChunkRef[],
  ): Promise<LlmListItem[] | null> {
    const response = await this.ai.chatJson<{ items?: LlmListItem[] }>({
      task: 'tenderParse',
      systemPrompt: [
        'You extract structured tender list items for a specific sub-topic.',
        'Return JSON only.',
        'Schema: {"items":[{"title":"short title","content":"structured content","confidence":0.0,"sourceChunkIds":["chunk-id"],"sourceQuote":"quote","validationNotes":"optional"}]}',
        'Keep content concise and display-ready.',
        'If nothing matches, return an empty items array.',
      ].join('\n'),
      userContent: JSON.stringify({
        category: category.label,
        subTab: subtab.label,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          sectionPath: chunk.sectionPath,
          text: this.trimText(chunk.text, 1200),
        })),
      }),
      temperature: 0.2,
      maxTokens: 1800,
    });
    return response?.items ?? null;
  }

  private countKeywordHitChunks(chunks: PersistedChunkRef[], keywords: string[]) {
    return chunks.filter(
      (chunk) => this.scoreChunk(`${chunk.sectionPath ?? ''}\n${chunk.text}`, keywords) > 0,
    ).length;
  }

  private shouldSupplementListItems(
    chunks: PersistedChunkRef[],
    keywords: string[],
    ruleItems: ExtractedListItem[],
  ) {
    if (this.countKeywordHitChunks(chunks, keywords) <= 1) {
      return true;
    }

    if (ruleItems.length <= 1 && chunks.some((chunk) => this.hasDenseRequirementSignals(chunk.text))) {
      return true;
    }

    return false;
  }

  private pickCandidateChunks(chunks: PersistedChunkRef[], keywords: string[], limit: number) {
    const scored = chunks
      .map((chunk) => ({
        chunk,
        score:
          this.scoreChunk(chunk.text, keywords) +
          (chunk.sectionPath ? this.scoreChunk(chunk.sectionPath, keywords) : 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return (right.chunk.importanceScore ?? 0) - (left.chunk.importanceScore ?? 0);
      })
      .slice(0, limit)
      .map((entry) => entry.chunk);

    if (scored.length > 0) {
      return scored;
    }

    return [...chunks]
      .sort((left, right) => (right.importanceScore ?? 0) - (left.importanceScore ?? 0))
      .slice(0, limit);
  }

  private inferChunkType(text: string, blockTypes: PersistedBlockRef['blockType'][] = []): ChunkDraft['chunkType'] {
    if (blockTypes.some((type) => type === 'TABLE_ROW' || type === 'TABLE_CELL')) return 'TABLE_REQUIREMENT';
    if (/(系统功能要求|系统技术要求|技术服务要求|服务要求|实施计划|国产化|安全|备份|高可用|数据质量)/.test(text)) {
      return 'TABLE_REQUIREMENT';
    }
    if (/(评分|分值|评标|评审|score|review)/i.test(text)) return 'REVIEW_RULE';
    if (/(提交|材料|授权书|营业执照|证明文件|submission|document)/i.test(text)) return 'SUBMISSION_LIST';
    if (/(资格|资质|业绩|财务|信用|qualification|license|finance)/i.test(text)) return 'QUALIFICATION_CLAUSE';
    return 'PARAGRAPH_WINDOW';
  }

  private extractKeywords(text: string) {
    const candidates = [
      '项目名称',
      '项目编号',
      '采购要求',
      '业务要求',
      '功能要求',
      '业务需求',
      '系统功能要求',
      '系统技术要求',
      '技术要求',
      '技术服务要求',
      '服务要求',
      '实施计划',
      '项目管理方案',
      '访问交互',
      '国产化',
      '安全',
      '备份',
      '高可用',
      '数据质量',
      '审计',
      '资格',
      '资质',
      '评审',
      '评分',
      '投标文件',
      '废标',
      '提交材料',
      '保证金',
      '答疑',
    ];
    return candidates.filter((keyword) => text.includes(keyword));
  }

  private isStandaloneRequirementBlock(block: PersistedBlockRef) {
    return block.blockType === 'LIST_ITEM' || block.blockType === 'TABLE_ROW' || block.blockType === 'TABLE_CELL';
  }

  private calculateImportanceScore(
    text: string,
    sectionPath: string | undefined,
    blockTypes: PersistedBlockRef['blockType'][],
  ) {
    const base = Math.min(1, text.length / 520);
    const structuredBonus =
      blockTypes.some((type) => type === 'LIST_ITEM' || type === 'TABLE_ROW' || type === 'TABLE_CELL') ? 0.18 : 0;
    const keywordBonus = this.hasDenseRequirementSignals(text) ? 0.16 : 0;
    const sectionBonus = sectionPath ? 0.18 : 0;
    return Number(Math.min(1.6, base + structuredBonus + keywordBonus + sectionBonus).toFixed(2));
  }

  private extractStructuredSegments(text: string) {
    const lines = text
      .replace(/\r/g, '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return [];
    }

    const segments: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (this.isStructuredListLine(line) && current.length > 0) {
        segments.push(current.join('\n'));
        current = [line];
        continue;
      }
      current.push(line);
    }
    if (current.length > 0) {
      segments.push(current.join('\n'));
    }

    if (segments.length > 1) {
      return segments;
    }

    const inlineSegments = Array.from(
      text.matchAll(/(?:^|[；;。\n])\s*((?:\d+[.、)]|[（(][一二三四五六七八九十]+[）)])\s*[^；;。\n]+)/g),
    )
      .map((match) => match[1]?.trim() ?? '')
      .filter(Boolean);
    if (inlineSegments.length > 1) {
      return inlineSegments;
    }

    return segments;
  }

  private isStructuredListLine(line: string) {
    return /^(?:\d+[.、)]|[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+、)/.test(line);
  }

  private hasDenseRequirementSignals(text: string) {
    const markerCount = Array.from(text.matchAll(/(?:^|\n)\s*(?:\d+[.、)]|[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+、)/g))
      .length;
    if (markerCount >= 2) {
      return true;
    }
    if (text.includes('|')) {
      return true;
    }
    return /(系统功能要求|系统技术要求|技术服务要求|服务要求|实施计划|项目管理方案|国产化|安全|备份|高可用|数据质量)/.test(text);
  }

  private cleanRequirementSegment(text: string) {
    return text
      .replace(/^[\s\u3000]+/, '')
      .replace(/^(?:\d+[.、)]|[（(][一二三四五六七八九十]+[）)]|[一二三四五六七八九十]+、)\s*/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractListItemTitle(text: string, fallbackLabel: string, index: number) {
    const keywordMatch = text.match(
      /(系统功能要求|业务要求|功能要求|业务需求|系统技术要求|技术要求|技术服务要求|服务要求|实施计划|项目管理方案|培训方案|运维(?:免费)?保修(?:期限)?|访问交互|国产化|安全设计|备份要求|高可用|数据质量|审计)/,
    );
    if (keywordMatch?.[1]) {
      const matched = keywordMatch[1].trim();
      return /要求|方案|计划|保修|审计/.test(matched) ? matched : `${matched}响应`;
    }

    const labelMatch = text.match(/^([^：:]{2,30})[:：]/);
    if (labelMatch?.[1]) {
      return labelMatch[1].trim();
    }

    const firstSentence = text.split(/[；;。]/)[0]?.trim() ?? '';
    return this.trimText(firstSentence || `${fallbackLabel} ${index + 1}`, 36);
  }

  private dedupeListItems(items: ExtractedListItem[]) {
    const deduped: ExtractedListItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = `${this.normalizeText(item.title)}::${this.normalizeText(item.content)}`;
      if (!item.title || !item.content || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
    }
    return deduped;
  }

  private scoreChunk(text: string, keywords: string[]) {
    return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
  }

  private trimText(text: string, maxLength: number) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  }

  private firstNonEmptyLine(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  }

  private sanitizeValue(value?: string | null) {
    const sanitized = (value ?? '')
      .replace(/^[：:\s]+/, '')
      .replace(/[：:\s]+$/, '')
      .trim();
    return sanitized || UNRESOLVED_VALUE;
  }

  private isInvalidScalarValue(field: TenderScalarFieldDefinition, value: string) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized === ':' || normalized === '：') {
      return true;
    }

    if (/^(招 标 文 件|目录|投标邀请书|投标人须知)$/i.test(normalized)) {
      return true;
    }

    if ((field.key === 'tender_name' || field.key === 'contact_name') && this.looksLikeProjectName(normalized)) {
      return true;
    }

    if (field.key === 'tender_name' || field.key === 'contact_name') {
      return !this.looksLikeOrganizationName(normalized);
    }

    if (field.key === 'contact_phone' || field.key === 'project_contact_phone') {
      return !/[0-9０-９()（）\-—]{7,}/.test(normalized) || /(https?:\/\/|www\.|@)/i.test(normalized);
    }

    if (field.key === 'contact_website') {
      return !/(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})/i.test(normalized);
    }

    if (field.key === 'email') {
      return !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized);
    }

    if (field.key === 'business_contact' || field.key === 'technical_contact' || field.key === 'project_contact_name') {
      return !/^[A-Za-z\u4E00-\u9FA5·]{2,20}$/.test(normalized);
    }

    if (field.key === 'project_scope') {
      return normalized.length < 8;
    }

    if (field.key === 'review_method') {
      return !/(评标办法|综合评分法|最低评标价法|综合评估法|评分法)/.test(normalized);
    }

    if (field.key === 'award_method') {
      return !/(定标|排序|方法|方式)/.test(normalized);
    }

    if (field.key === 'validity') {
      return !/[0-9０-９]+\s*(天|日|小时|月|年)/.test(normalized);
    }

    if (field.key === 'deadline' || field.key === 'open_time' || field.key === 'clarify_deadline') {
      return !/[0-9０-９]{2,4}/.test(normalized);
    }

    return false;
  }

  private looksLikeOrganizationName(value: string) {
    const normalized = value.replace(/\s+/g, '');
    return (
      /(?:公司|集团|单位|机构|中心|委员会|研究院|研究所|医院|学校|大学|学院|银行|有限责任公司|有限公司)$/.test(normalized) &&
      !this.looksLikeProjectName(normalized)
    );
  }

  private looksLikeProjectName(value: string) {
    return /(?:项目|采购|招标|标段|建设|系统|平台|工程)/.test(value);
  }

  private isLabelLine(line: string, keyword: string) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith(keyword.toLowerCase())) {
      return false;
    }

    const suffix = trimmed.slice(keyword.length).trim();
    return !suffix || /^[:：\-—]+$/.test(suffix);
  }

  private composeParseResultDraft(
    summary: string,
    items: ParseResultItemDraft[],
    provider: Awaited<ReturnType<AiService['getTaskProvider']>>,
    llmUsed: boolean,
  ): ParseResultDraft {
    return {
      summary: summary || 'Tender parsing completed.',
      items: [...items],
      modelProvider: llmUsed ? provider?.vendor ?? 'openai-compatible' : 'rule-based',
      modelName: llmUsed ? provider?.model ?? 'unknown' : 'minimal-pipeline',
      promptVersion: llmUsed ? 'tender-hybrid-v1' : 'tender-rule-v1',
      schemaVersion: 'tender-structured-v1',
    };
  }

  private normalizeConfidence(value: unknown, fallback: number) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.trim())
          : Number.NaN;
    const resolved = Number.isFinite(numeric) ? numeric : fallback;
    return Number(Math.min(0.99, Math.max(0, resolved)).toFixed(2));
  }

  private normalizeText(value?: string | null) {
    return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
