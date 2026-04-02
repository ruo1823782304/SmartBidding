import type { ComplianceRecommendationResult } from "../types/compliance";
import { getBackendToken, requestJson } from "./backend-api";
const complianceRecommendationCache = new Map<string, Promise<ComplianceRecommendationResult>>();

export async function fetchComplianceRecommendations(projectId: string, cacheKey = projectId) {
  const cached = complianceRecommendationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const request = (async () => {
    const token = await getBackendToken();
    return requestJson<ComplianceRecommendationResult>(
      `/projects/${encodeURIComponent(projectId)}/compliance/recommendations`,
      undefined,
      token,
    );
  })();

  complianceRecommendationCache.set(cacheKey, request);
  try {
    return await request;
  } catch (error) {
    complianceRecommendationCache.delete(cacheKey);
    throw error;
  }
}
