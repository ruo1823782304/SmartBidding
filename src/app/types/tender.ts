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

export type TenderAnalysisCompletePayload = {
  remoteProjectId: string;
  remoteFileId: string;
  remoteTaskId: string;
  uploadedTender: { name: string; size: string; format: string };
  requirements: TenderRequirement[];
  categories: TenderParsedCategory[];
  outline: string;
  summary: string;
  parsedAt: string;
};
