export type BidKind = "tech" | "biz";

export type OutlineNodeSourceType = "tender" | "inferred" | "reference";

export type OutlineNode = {
  id: string;
  title: string;
  detail?: string;
  sourceItemIds?: string[];
  sourceType?: OutlineNodeSourceType;
  boundRequirementText?: string;
  children: OutlineNode[];
};

export type OutlineGroup = {
  id: string;
  group: string;
  detail?: string;
  sections: OutlineNode[];
};

export type FlattenedOutlineNode = {
  id: string;
  title: string;
  detail?: string;
  sourceItemIds?: string[];
  sourceType?: OutlineNodeSourceType;
  boundRequirementText?: string;
  numbering: string;
  level: number;
  groupLabel: string;
  pathTitles: string[];
  sectionPath: string;
};

export type ProposalSectionRecord = {
  sectionKey: string;
  content: string;
  completed: boolean;
  version: number;
  lastEditedAt?: string;
  lastEditedBy?: string;
};

export type ProposalSectionListResponse = {
  list: ProposalSectionRecord[];
};

export type ProposalOutlineResponse = {
  tenderOutline?: string;
  techOutlineSections?: OutlineGroup[];
  bizOutlineSections?: OutlineGroup[];
};

export type ProposalRecommendationItem = {
  id: string;
  title: string;
  category: string;
  subtype?: string;
  content?: string;
  snippet?: string;
  score?: number;
};
