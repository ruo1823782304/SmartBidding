export interface TenderRequirement {
  id: string;
  sectionId: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  required: boolean;
}

export type TenderSourceTrace = {
  id: string;
  outline: string;
  location: string;
  quote: string;
  paragraph: string;
  pageNo?: number | null;
  documentVersionId?: string | null;
  sourceItemId?: string;
  blocks?: TenderSourceTraceBlock[];
};

export type TenderSourceTraceBlock = {
  blockId: string;
  pageNo?: number | null;
  paragraphNo?: number | null;
  sectionPath?: string | null;
  quote?: string | null;
};

export type TenderParsedItem = {
  id: string;
  title: string;
  content: string;
  trace: TenderSourceTrace;
};

export type TenderParsedGroup = {
  key: string;
  label: string;
  items: TenderParsedItem[];
};

export type TenderParsedCategory = {
  key: string;
  label: string;
  groups: TenderParsedGroup[];
};

export type TenderCategoryAnalysisStatus = "pending" | "running" | "completed" | "failed";

export type TenderCategoryProgress = {
  key: string;
  label: string;
  status: TenderCategoryAnalysisStatus;
  itemCount: number;
};

export type TenderAnalysisProgressPayload = {
  progress: number;
  stage: string;
  summary: string;
  categories: TenderParsedCategory[];
  categoryProgress: TenderCategoryProgress[];
};

export type TenderAnalysisCompletePayload = {
  remoteProjectId: string;
  remoteFileId: string;
  remoteTaskId: string;
  uploadedTender: { name: string; size: string; format: string };
  requirements: TenderRequirement[];
  categories: TenderParsedCategory[];
  categoryProgress: TenderCategoryProgress[];
  outline: string;
  summary: string;
  parsedAt: string;
};
