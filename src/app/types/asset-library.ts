export type AssetCategory =
  | "ingest"
  | "qualification"
  | "performance"
  | "solution"
  | "archive"
  | "winning"
  | "resume";

export type EnterpriseAsset = {
  id: string;
  title: string;
  category: AssetCategory | string;
  subtype?: string;
  sourceMode?: string;
  fileUrl?: string;
  snippet?: string;
  tags?: string[];
  metadata?: unknown;
  ingestJobId?: string;
  uploadedAt: string;
  uploadedBy?: string;
  downloadUrl?: string;
  downloadable?: boolean;
};

export type AssetListResponse = {
  list: EnterpriseAsset[];
  total: number;
};

export type LibraryIngestJobSummary = {
  id: string;
  status: "pending" | "running" | "succeeded" | "partial_review" | "failed" | string;
  progress: number;
  sourceFileName: string;
  archiveMirrored: boolean;
  successCount: number;
  unresolvedCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type LibraryIngestItem = {
  id: string;
  status: "completed" | "pending_review" | string;
  targetCategory?: AssetCategory | string;
  targetSubtype?: string;
  suggestedCategory?: AssetCategory | string;
  suggestedSubtype?: string;
  suggestedTitle?: string;
  finalTitle?: string;
  sourceQuote?: string;
  sourceOutline?: string;
  content?: string;
  metadata?: unknown;
  assetId?: string;
  downloadable?: boolean;
  downloadUrl?: string;
};

export type LibraryIngestJobDetail = {
  job: LibraryIngestJobSummary;
  items: LibraryIngestItem[];
  sourceAsset?: EnterpriseAsset;
  archiveAsset?: EnterpriseAsset;
};
