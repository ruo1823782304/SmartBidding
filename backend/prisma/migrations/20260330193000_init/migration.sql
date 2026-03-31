-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('TENDER', 'ASSET', 'HISTORY_PROPOSAL', 'EXPORT');

-- CreateEnum
CREATE TYPE "DocumentBizCategory" AS ENUM ('TENDER_SOURCE', 'COMPANY_PROFILE', 'CASE_STUDY', 'QUALIFICATION', 'FINANCIAL', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PARSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ParseJobType" AS ENUM ('TENDER_PARSE', 'ASSET_PARSE', 'REINDEX');

-- CreateEnum
CREATE TYPE "ParseJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ParseJobStage" AS ENUM ('UPLOAD', 'DOCLING', 'BLOCK_EXTRACT', 'CHUNK_INDEX', 'LLM_EXTRACT', 'FINALIZE');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('TITLE', 'HEADING', 'PARAGRAPH', 'LIST_ITEM', 'TABLE', 'TABLE_ROW', 'TABLE_CELL');

-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('SECTION_SUMMARY', 'PARAGRAPH_WINDOW', 'TABLE_REQUIREMENT', 'QUALIFICATION_CLAUSE', 'REVIEW_RULE', 'SUBMISSION_LIST');

-- CreateEnum
CREATE TYPE "MajorParseCode" AS ENUM ('basic_info', 'qualification_requirements', 'review_requirements', 'bid_document_requirements', 'invalid_and_rejection', 'required_submission_documents', 'tender_document_review', 'other');

-- CreateEnum
CREATE TYPE "ParseReviewStatus" AS ENUM ('AUTO', 'CONFIRMED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "RetrievalScene" AS ENUM ('PARSE', 'PROPOSAL_ASSIST', 'ASSET_SEARCH');

-- CreateEnum
CREATE TYPE "RetrievalStrategy" AS ENUM ('BM25', 'VECTOR', 'HYBRID');

-- CreateEnum
CREATE TYPE "RetrievalSource" AS ENUM ('TENDER', 'ASSET', 'HISTORY');

-- CreateEnum
CREATE TYPE "GenerationScene" AS ENUM ('TENDER_PARSE', 'SECTION_DRAFT', 'SECTION_REWRITE', 'QA');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('TENDER', 'ASSET', 'HISTORY');

-- CreateEnum
CREATE TYPE "EvidenceUsedFor" AS ENUM ('DIRECT_QUOTE', 'FACT_REFERENCE', 'DRAFT_SUPPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "contact" TEXT,
    "role" TEXT NOT NULL,
    "superior" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT,
    "deadline" TEXT,
    "progress" TEXT,
    "type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "archivedAt" TIMESTAMP(3),
    "tender_outline" TEXT,
    "tech_outline_sections" JSONB,
    "biz_outline_sections" JSONB,
    "proposal_status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderFile" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER,
    "document_id" TEXT,
    "document_version_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderParseTask" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "file_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderParseTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionContent" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "last_edited_at" TIMESTAMP(3),
    "last_edited_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectionContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAssignment" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "requirement" TEXT,
    "urgency" TEXT,
    "section_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role_name" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress" TEXT DEFAULT '0%',

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskHistory" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "operator" TEXT NOT NULL,

    CONSTRAINT "TaskHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT,
    "content" TEXT,
    "snippet" TEXT,
    "tags" JSONB,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "improvements" TEXT,
    "score_breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rival" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT,
    "advantage" TEXT,
    "weakness" TEXT,
    "strategy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RivalProject" (
    "rival_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,

    CONSTRAINT "RivalProject_pkey" PRIMARY KEY ("rival_id","project_id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "asset_id" TEXT,
    "document_type" "DocumentType" NOT NULL,
    "biz_category" "DocumentBizCategory" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_ext" TEXT,
    "current_version_id" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "storage_bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER,
    "content_hash" TEXT,
    "parse_status" "ParseJobStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "page_no" INTEGER NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "rotation" INTEGER,
    "image_key" TEXT,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentBlock" (
    "id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "page_id" TEXT,
    "block_type" "BlockType" NOT NULL,
    "section_path" TEXT,
    "heading_level" INTEGER,
    "paragraph_no" INTEGER,
    "text" TEXT NOT NULL,
    "text_hash" TEXT,
    "tokens" INTEGER,
    "bbox" JSONB,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_type" "ChunkType" NOT NULL,
    "source_block_ids" JSONB NOT NULL,
    "section_path" TEXT,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "text" TEXT NOT NULL,
    "text_for_embedding" TEXT,
    "keywords" JSONB,
    "tsv" tsvector,
    "embedding" JSONB,
    "importance_score" DOUBLE PRECISION,
    "document_type" "DocumentType" NOT NULL,
    "biz_category" "DocumentBizCategory" NOT NULL DEFAULT 'OTHER',
    "version_no" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseJob" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "document_id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "job_type" "ParseJobType" NOT NULL,
    "status" "ParseJobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "current_stage" "ParseJobStage",
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParseJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseResult" (
    "id" TEXT NOT NULL,
    "parse_job_id" TEXT NOT NULL,
    "project_id" TEXT,
    "document_id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParseResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParseResultItem" (
    "id" TEXT NOT NULL,
    "parse_result_id" TEXT NOT NULL,
    "major_code" "MajorParseCode" NOT NULL,
    "minor_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "normalized_value" JSONB,
    "confidence" DOUBLE PRECISION,
    "priority" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'low',
    "source_paragraph_ids" JSONB NOT NULL,
    "source_chunk_ids" JSONB NOT NULL,
    "source_quote" TEXT,
    "review_status" "ParseReviewStatus" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParseResultItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalLog" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "scene" "RetrievalScene" NOT NULL,
    "query_text" TEXT NOT NULL,
    "query_intent" TEXT,
    "filters" JSONB,
    "top_k" INTEGER NOT NULL DEFAULT 10,
    "retrieval_strategy" "RetrievalStrategy" NOT NULL,
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetrievalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalLogHit" (
    "id" TEXT NOT NULL,
    "retrieval_log_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "source" "RetrievalSource" NOT NULL,
    "bm25_score" DOUBLE PRECISION,
    "vector_score" DOUBLE PRECISION,
    "hybrid_score" DOUBLE PRECISION,
    "rank_before_rerank" INTEGER,
    "rank_after_rerank" INTEGER,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RetrievalLogHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationLog" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "scene" "GenerationScene" NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT,
    "temperature" DOUBLE PRECISION,
    "prompt_version" TEXT NOT NULL,
    "system_prompt" TEXT,
    "user_prompt" TEXT,
    "response_text" TEXT,
    "response_json" JSONB,
    "status" "GenerationStatus" NOT NULL,
    "error_message" TEXT,
    "latency_ms" INTEGER,
    "token_usage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationCitation" (
    "id" TEXT NOT NULL,
    "generation_log_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "block_ids" JSONB NOT NULL,
    "quote" TEXT NOT NULL,
    "citation_order" INTEGER NOT NULL,

    CONSTRAINT "GenerationCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionEvidence" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "section_content_id" TEXT,
    "source_type" "EvidenceSourceType" NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_version_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "block_ids" JSONB NOT NULL,
    "quote" TEXT NOT NULL,
    "used_for" "EvidenceUsedFor" NOT NULL,
    "created_by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "TenderFile_project_id_idx" ON "TenderFile"("project_id");

-- CreateIndex
CREATE INDEX "TenderFile_document_id_idx" ON "TenderFile"("document_id");

-- CreateIndex
CREATE INDEX "TenderFile_document_version_id_idx" ON "TenderFile"("document_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "SectionContent_project_id_section_key_key" ON "SectionContent"("project_id", "section_key");

-- CreateIndex
CREATE INDEX "SectionAssignment_project_id_idx" ON "SectionAssignment"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "SectionAssignment_project_id_section_key_username_key" ON "SectionAssignment"("project_id", "section_key", "username");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_task_id_username_key" ON "TaskAssignment"("task_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRecord_project_id_key" ON "ReviewRecord"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Document_current_version_id_key" ON "Document"("current_version_id");

-- CreateIndex
CREATE INDEX "Document_project_id_document_type_idx" ON "Document"("project_id", "document_type");

-- CreateIndex
CREATE INDEX "Document_asset_id_idx" ON "Document"("asset_id");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "DocumentVersion_document_id_parse_status_idx" ON "DocumentVersion"("document_id", "parse_status");

-- CreateIndex
CREATE INDEX "DocumentVersion_content_hash_idx" ON "DocumentVersion"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_document_id_version_no_key" ON "DocumentVersion"("document_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_document_version_id_page_no_key" ON "DocumentPage"("document_version_id", "page_no");

-- CreateIndex
CREATE INDEX "DocumentBlock_document_version_id_page_id_idx" ON "DocumentBlock"("document_version_id", "page_id");

-- CreateIndex
CREATE INDEX "DocumentBlock_document_version_id_block_type_idx" ON "DocumentBlock"("document_version_id", "block_type");

-- CreateIndex
CREATE INDEX "DocumentBlock_document_version_id_paragraph_no_idx" ON "DocumentBlock"("document_version_id", "paragraph_no");

-- CreateIndex
CREATE INDEX "DocumentBlock_document_version_id_text_hash_idx" ON "DocumentBlock"("document_version_id", "text_hash");

-- CreateIndex
CREATE INDEX "DocumentChunk_document_version_id_section_path_idx" ON "DocumentChunk"("document_version_id", "section_path");

-- CreateIndex
CREATE INDEX "DocumentChunk_document_type_biz_category_idx" ON "DocumentChunk"("document_type", "biz_category");

-- CreateIndex
CREATE INDEX "DocumentChunk_document_id_version_no_idx" ON "DocumentChunk"("document_id", "version_no");

-- CreateIndex
CREATE INDEX "ParseJob_project_id_createdAt_idx" ON "ParseJob"("project_id", "createdAt");

-- CreateIndex
CREATE INDEX "ParseJob_document_version_id_status_idx" ON "ParseJob"("document_version_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ParseResult_parse_job_id_key" ON "ParseResult"("parse_job_id");

-- CreateIndex
CREATE INDEX "ParseResult_project_id_createdAt_idx" ON "ParseResult"("project_id", "createdAt");

-- CreateIndex
CREATE INDEX "ParseResult_document_version_id_schema_version_idx" ON "ParseResult"("document_version_id", "schema_version");

-- CreateIndex
CREATE INDEX "ParseResultItem_parse_result_id_major_code_idx" ON "ParseResultItem"("parse_result_id", "major_code");

-- CreateIndex
CREATE INDEX "ParseResultItem_parse_result_id_major_code_minor_code_idx" ON "ParseResultItem"("parse_result_id", "major_code", "minor_code");

-- CreateIndex
CREATE INDEX "ParseResultItem_risk_level_idx" ON "ParseResultItem"("risk_level");

-- CreateIndex
CREATE INDEX "RetrievalLogHit_retrieval_log_id_rank_after_rerank_idx" ON "RetrievalLogHit"("retrieval_log_id", "rank_after_rerank");

-- CreateIndex
CREATE INDEX "SectionEvidence_project_id_section_key_idx" ON "SectionEvidence"("project_id", "section_key");

-- CreateIndex
CREATE INDEX "SectionEvidence_section_content_id_idx" ON "SectionEvidence"("section_content_id");

-- AddForeignKey
ALTER TABLE "TenderFile" ADD CONSTRAINT "TenderFile_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderFile" ADD CONSTRAINT "TenderFile_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderFile" ADD CONSTRAINT "TenderFile_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderParseTask" ADD CONSTRAINT "TenderParseTask_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderParseTask" ADD CONSTRAINT "TenderParseTask_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "TenderFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionContent" ADD CONSTRAINT "SectionContent_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHistory" ADD CONSTRAINT "TaskHistory_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RivalProject" ADD CONSTRAINT "RivalProject_rival_id_fkey" FOREIGN KEY ("rival_id") REFERENCES "Rival"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RivalProject" ADD CONSTRAINT "RivalProject_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentBlock" ADD CONSTRAINT "DocumentBlock_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentBlock" ADD CONSTRAINT "DocumentBlock_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "DocumentPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseJob" ADD CONSTRAINT "ParseJob_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseJob" ADD CONSTRAINT "ParseJob_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseJob" ADD CONSTRAINT "ParseJob_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseResult" ADD CONSTRAINT "ParseResult_parse_job_id_fkey" FOREIGN KEY ("parse_job_id") REFERENCES "ParseJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseResult" ADD CONSTRAINT "ParseResult_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseResult" ADD CONSTRAINT "ParseResult_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseResult" ADD CONSTRAINT "ParseResult_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParseResultItem" ADD CONSTRAINT "ParseResultItem_parse_result_id_fkey" FOREIGN KEY ("parse_result_id") REFERENCES "ParseResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalLog" ADD CONSTRAINT "RetrievalLog_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalLogHit" ADD CONSTRAINT "RetrievalLogHit_retrieval_log_id_fkey" FOREIGN KEY ("retrieval_log_id") REFERENCES "RetrievalLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalLogHit" ADD CONSTRAINT "RetrievalLogHit_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationLog" ADD CONSTRAINT "GenerationLog_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationCitation" ADD CONSTRAINT "GenerationCitation_generation_log_id_fkey" FOREIGN KEY ("generation_log_id") REFERENCES "GenerationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationCitation" ADD CONSTRAINT "GenerationCitation_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEvidence" ADD CONSTRAINT "SectionEvidence_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEvidence" ADD CONSTRAINT "SectionEvidence_section_content_id_fkey" FOREIGN KEY ("section_content_id") REFERENCES "SectionContent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEvidence" ADD CONSTRAINT "SectionEvidence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEvidence" ADD CONSTRAINT "SectionEvidence_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionEvidence" ADD CONSTRAINT "SectionEvidence_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom index for hybrid retrieval
CREATE INDEX "idx_document_chunk_tsv" ON "DocumentChunk" USING GIN ("tsv");
