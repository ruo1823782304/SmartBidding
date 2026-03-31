export type RagBlockType =
  | 'TITLE'
  | 'HEADING'
  | 'PARAGRAPH'
  | 'LIST_ITEM'
  | 'TABLE'
  | 'TABLE_ROW'
  | 'TABLE_CELL';

export type RagChunkType =
  | 'SECTION_SUMMARY'
  | 'PARAGRAPH_WINDOW'
  | 'TABLE_REQUIREMENT'
  | 'QUALIFICATION_CLAUSE'
  | 'REVIEW_RULE'
  | 'SUBMISSION_LIST';

export type MajorParseCode =
  | 'basic_info'
  | 'qualification_requirements'
  | 'review_requirements'
  | 'bid_document_requirements'
  | 'invalid_and_rejection'
  | 'required_submission_documents'
  | 'tender_document_review'
  | 'other';

export interface StructuredDocumentPage {
  pageNo: number;
  width?: number;
  height?: number;
  rotation?: number;
  imageKey?: string;
}

export interface StructuredDocumentBlock {
  pageNo: number;
  blockType: RagBlockType;
  sectionPath?: string;
  headingLevel?: number;
  paragraphNo?: number;
  text: string;
  bbox?: unknown;
  metadata?: Record<string, unknown>;
}

export interface StructuredDocument {
  pages: StructuredDocumentPage[];
  blocks: StructuredDocumentBlock[];
  metadata?: Record<string, unknown>;
}

export interface PersistedBlockRef {
  id: string;
  pageNo: number;
  blockType: RagBlockType;
  sectionPath?: string;
  paragraphNo?: number;
  text: string;
}

export interface ChunkDraft {
  chunkType: RagChunkType;
  sourceBlockIds: string[];
  sectionPath?: string;
  pageStart?: number;
  pageEnd?: number;
  text: string;
  textForEmbedding?: string;
  keywords?: string[];
  importanceScore?: number;
}

export interface PersistedChunkRef extends ChunkDraft {
  id: string;
}

export interface ParseResultItemDraft {
  majorCode: MajorParseCode;
  minorCode: string;
  title: string;
  content: string;
  normalizedValue?: Record<string, unknown>;
  confidence?: number;
  priority?: string;
  isRequired: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  sourceParagraphIds: string[];
  sourceChunkIds: string[];
  sourceQuote?: string;
}

export interface ParseResultDraft {
  summary: string;
  items: ParseResultItemDraft[];
}
