-- AlterTable
ALTER TABLE "Asset"
ADD COLUMN "subtype" TEXT,
ADD COLUMN "source_mode" TEXT DEFAULT 'manual',
ADD COLUMN "metadata" JSONB,
ADD COLUMN "ingest_job_id" TEXT;

-- CreateTable
CREATE TABLE "LibraryIngestJob" (
    "id" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "archive_mirrored" BOOLEAN NOT NULL DEFAULT false,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "unresolved_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "source_asset_id" TEXT,
    "archive_asset_id" TEXT,
    "created_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryIngestJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryIngestItem" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target_category" TEXT,
    "target_subtype" TEXT,
    "suggested_category" TEXT,
    "suggested_subtype" TEXT,
    "suggested_title" TEXT,
    "final_title" TEXT,
    "source_quote" TEXT,
    "source_outline" TEXT,
    "content" TEXT,
    "source_block_ids" JSONB,
    "source_chunk_ids" JSONB,
    "asset_id" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryIngestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryIngestJob_source_asset_id_key" ON "LibraryIngestJob"("source_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryIngestJob_archive_asset_id_key" ON "LibraryIngestJob"("archive_asset_id");

-- CreateIndex
CREATE INDEX "LibraryIngestJob_status_createdAt_idx" ON "LibraryIngestJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryIngestItem_asset_id_key" ON "LibraryIngestItem"("asset_id");

-- CreateIndex
CREATE INDEX "LibraryIngestItem_job_id_status_idx" ON "LibraryIngestItem"("job_id", "status");

-- AddForeignKey
ALTER TABLE "Asset"
ADD CONSTRAINT "Asset_ingest_job_id_fkey" FOREIGN KEY ("ingest_job_id") REFERENCES "LibraryIngestJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryIngestJob"
ADD CONSTRAINT "LibraryIngestJob_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryIngestJob"
ADD CONSTRAINT "LibraryIngestJob_archive_asset_id_fkey" FOREIGN KEY ("archive_asset_id") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryIngestItem"
ADD CONSTRAINT "LibraryIngestItem_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "LibraryIngestJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryIngestItem"
ADD CONSTRAINT "LibraryIngestItem_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
