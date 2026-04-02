export type ComplianceSuggestionSeverity = "high" | "medium" | "low";

export type ComplianceSuggestionSectionKey = "check" | "score" | "library";

export type ComplianceSuggestionItem = {
  title: string;
  problem: string;
  suggestion: string;
  evidence?: string;
  severity: ComplianceSuggestionSeverity;
};

export type ComplianceRecommendationSection = {
  key: ComplianceSuggestionSectionKey;
  title: string;
  summary: string;
  items: ComplianceSuggestionItem[];
};

export type ComplianceRecommendationResult = {
  summary: string;
  riskCount: number;
  highRiskCount: number;
  generatedAt: string;
  sections: ComplianceRecommendationSection[];
};
