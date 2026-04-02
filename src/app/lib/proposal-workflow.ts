import type {
  BidKind,
  ProposalOutlineResponse,
  ProposalRecommendationItem,
  ProposalSectionListResponse,
} from "../types/proposal";
import { getBackendToken, requestBlob, requestJson } from "./backend-api";

export async function getProjectOutline(projectId: string) {
  const token = await getBackendToken();
  return requestJson<ProposalOutlineResponse>(`/projects/${projectId}/outline`, undefined, token);
}

export async function generateProjectOutline(projectId: string) {
  const token = await getBackendToken();
  return requestJson<ProposalOutlineResponse & { success: boolean }>(`/tender/outline/generate`, {
    method: "POST",
    body: JSON.stringify({ projectId }),
  }, token);
}

export async function saveProjectOutline(projectId: string, payload: ProposalOutlineResponse) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean }>(`/projects/${projectId}/outline`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }, token);
}

export async function listProposalSections(projectId: string) {
  const token = await getBackendToken();
  return requestJson<ProposalSectionListResponse>(`/projects/${projectId}/sections`, undefined, token);
}

export async function saveProposalSectionContent(projectId: string, sectionKey: string, content: string) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean; version: number }>(
    `/projects/${projectId}/sections/${encodeURIComponent(sectionKey)}/content`,
    {
      method: "PUT",
      body: JSON.stringify({ content }),
    },
    token,
  );
}

export async function setProposalSectionComplete(projectId: string, sectionKey: string, completed: boolean) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean }>(
    `/projects/${projectId}/sections/${encodeURIComponent(sectionKey)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ completed }),
    },
    token,
  );
}

export async function getProposalRecommendations(projectId: string, sectionKey: string, title: string) {
  const token = await getBackendToken();
  const query = new URLSearchParams();
  if (title) {
    query.set("title", title);
  }
  return requestJson<{ list: ProposalRecommendationItem[] }>(
    `/projects/${projectId}/sections/${encodeURIComponent(sectionKey)}/recommendations?${query.toString()}`,
    undefined,
    token,
  );
}

export async function generateProposalSection(projectId: string, sectionKey: string, payload: {
  context?: string;
  currentContent?: string;
  sectionTitle?: string;
  sectionDetail?: string;
  outlinePath?: string;
  bidKind?: BidKind;
  assetIds?: string[];
  sourceItemIds?: string[];
  boundRequirementText?: string;
  customPrompt?: string;
}) {
  const token = await getBackendToken();
  return requestJson<{ content: string }>(
    `/projects/${projectId}/sections/${encodeURIComponent(sectionKey)}/generate`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function prepareProposalExport(projectId: string, kind: BidKind) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean; downloadUrl: string; filename: string }>(
    `/projects/${projectId}/proposal/export`,
    {
      method: "POST",
      body: JSON.stringify({ format: "word", kind }),
    },
    token,
  );
}

function extractFileName(disposition: string | null, fallback: string) {
  if (!disposition) {
    return fallback;
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1];
  }

  return fallback;
}

export async function downloadProposalExport(projectId: string, kind: BidKind, fallbackName: string) {
  const token = await getBackendToken();
  const response = await requestBlob(
    `/projects/${projectId}/proposal/export/file?format=word&kind=${kind}`,
    undefined,
    token,
  );
  const blob = await response.blob();
  const fileName = extractFileName(response.headers.get("Content-Disposition"), fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
