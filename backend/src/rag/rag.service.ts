import { Injectable } from '@nestjs/common';
import { ChunkDraft, ParseResultDraft, ParseResultItemDraft, PersistedBlockRef, PersistedChunkRef } from './rag.types';
import { TENDER_PARSE_CATALOG } from './tender-parse.catalog';

@Injectable()
export class RagService {
  buildChunks(blocks: PersistedBlockRef[]): ChunkDraft[] {
    const chunks: ChunkDraft[] = [];
    let currentBuffer: PersistedBlockRef[] = [];

    const flush = () => {
      if (currentBuffer.length === 0) return;
      const text = currentBuffer.map((item) => item.text).join('\n');
      const sectionPath = currentBuffer[currentBuffer.length - 1]?.sectionPath;
      const pageNumbers = currentBuffer.map((item) => item.pageNo);
      chunks.push({
        chunkType: this.inferChunkType(text),
        sourceBlockIds: currentBuffer.map((item) => item.id),
        sectionPath,
        pageStart: Math.min(...pageNumbers),
        pageEnd: Math.max(...pageNumbers),
        text,
        textForEmbedding: text,
        keywords: this.extractKeywords(text),
        importanceScore: Number((Math.min(1, text.length / 600) + (sectionPath ? 0.2 : 0)).toFixed(2)),
      });
      currentBuffer = [];
    };

    for (const block of blocks) {
      if (block.blockType === 'HEADING' || block.blockType === 'TITLE') {
        flush();
        currentBuffer.push(block);
        continue;
      }

      currentBuffer.push(block);
      const currentLength = currentBuffer.reduce((sum, item) => sum + item.text.length, 0);
      if (currentLength >= 800) {
        flush();
      }
    }

    flush();
    return chunks;
  }

  buildParseResult(chunks: PersistedChunkRef[]): ParseResultDraft {
    const items: ParseResultItemDraft[] = TENDER_PARSE_CATALOG.flatMap((catalogItem) => {
      const matched = chunks
        .map((chunk) => ({
          chunk,
          score: this.scoreChunk(chunk.text, catalogItem.keywords),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      return matched.map(({ chunk }, index): ParseResultItemDraft => ({
        majorCode: catalogItem.majorCode,
        minorCode: `${catalogItem.fallbackMinorCode}_${index + 1}`,
        title: this.buildItemTitle(catalogItem.title, chunk.text, index),
        content: this.trimText(chunk.text, 280),
        normalizedValue: {
          sectionPath: chunk.sectionPath,
        },
        confidence: Number(Math.min(0.95, 0.55 + index * 0.08).toFixed(2)),
        priority: index === 0 ? 'high' : 'medium',
        isRequired: catalogItem.majorCode !== 'other',
        riskLevel:
          catalogItem.majorCode === 'invalid_and_rejection' || catalogItem.majorCode === 'tender_document_review'
            ? 'high'
            : 'medium',
        sourceParagraphIds: chunk.sourceBlockIds,
        sourceChunkIds: [chunk.id],
        sourceQuote: this.trimText(chunk.text, 120),
      }));
    });

    const summary = chunks
      .slice(0, 3)
      .map((chunk) => this.trimText(chunk.text, 120))
      .join(' ');

    return {
      summary: summary || 'The parsing pipeline completed, but no summary text was extracted yet.',
      items,
    };
  }

  private inferChunkType(text: string): ChunkDraft['chunkType'] {
    if (/(评分|分值|评标|评审|score|review)/i.test(text)) return 'REVIEW_RULE';
    if (/(提交|材料|授权书|营业执照|证明文件|submission|document)/i.test(text)) return 'SUBMISSION_LIST';
    if (/(资格|资质|业绩|财务|信用|qualification|license|finance)/i.test(text)) return 'QUALIFICATION_CLAUSE';
    return 'PARAGRAPH_WINDOW';
  }

  private extractKeywords(text: string) {
    const candidates = [
      '项目名称',
      '项目编号',
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

  private scoreChunk(text: string, keywords: string[]) {
    return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
  }

  private trimText(text: string, maxLength: number) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  }

  private buildItemTitle(majorTitle: string, text: string, index: number) {
    const firstLine = text.split('\n')[0]?.trim();
    if (firstLine && firstLine.length <= 24) {
      return firstLine;
    }
    return `${majorTitle} item ${index + 1}`;
  }
}
