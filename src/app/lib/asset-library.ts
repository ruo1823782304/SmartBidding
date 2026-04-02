import type {
  AssetCategory,
  AssetListResponse,
  LibraryIngestJobDetail,
  LibraryIngestJobSummary,
} from "../types/asset-library";
import { getBackendToken, requestBlob, requestJson } from "./backend-api";

export async function listAssets(params: {
  category?: AssetCategory | string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  subtype?: string;
  sourceMode?: string;
  jobId?: string;
}) {
  const token = await getBackendToken();
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.subtype) query.set("subtype", params.subtype);
  if (params.sourceMode) query.set("sourceMode", params.sourceMode);
  if (params.jobId) query.set("jobId", params.jobId);
  return requestJson<AssetListResponse>(`/assets?${query.toString()}`, undefined, token);
}

export async function createIngestJob(file: File) {
  const token = await getBackendToken();
  const body = new FormData();
  body.append("file", file);
  return requestJson<LibraryIngestJobDetail>("/assets/ingest/jobs", {
    method: "POST",
    body,
  }, token);
}

export async function listIngestJobs() {
  const token = await getBackendToken();
  return requestJson<{ list: LibraryIngestJobSummary[] }>("/assets/ingest/jobs", undefined, token);
}

export async function getIngestJob(jobId: string) {
  const token = await getBackendToken();
  return requestJson<LibraryIngestJobDetail>(`/assets/ingest/jobs/${jobId}`, undefined, token);
}

export async function confirmIngestItem(
  itemId: string,
  input: { targetCategory?: string; targetSubtype?: string; title?: string },
) {
  const token = await getBackendToken();
  return requestJson<LibraryIngestJobDetail>(`/assets/ingest/items/${itemId}/confirm`, {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export async function deleteIngestJob(jobId: string) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean }>(`/assets/ingest/jobs/${jobId}`, {
    method: "DELETE",
  }, token);
}

export async function finalizeIngestJob(jobId: string) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean }>(`/assets/ingest/jobs/${jobId}/finalize`, {
    method: "POST",
  }, token);
}

export async function deleteIngestItem(itemId: string) {
  const token = await getBackendToken();
  return requestJson<LibraryIngestJobDetail>(`/assets/ingest/items/${itemId}`, {
    method: "DELETE",
  }, token);
}

export async function deleteAsset(assetId: string) {
  const token = await getBackendToken();
  return requestJson<{ success: boolean }>(`/assets/${assetId}`, {
    method: "DELETE",
  }, token);
}

export async function uploadAssetFile(input: {
  category: string;
  file: File;
  title?: string;
  subtype?: string;
  sourceMode?: string;
  metadata?: Record<string, unknown>;
}) {
  const token = await getBackendToken();
  const body = new FormData();
  body.append("category", input.category);
  body.append("file", input.file);
  if (input.title) body.append("title", input.title);
  if (input.subtype) body.append("subtype", input.subtype);
  body.append("sourceMode", input.sourceMode ?? "manual");
  if (input.metadata) {
    body.append("metadata", JSON.stringify(input.metadata));
  }
  return requestJson<{ success: boolean }>(`/assets`, {
    method: "POST",
    body,
  }, token);
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

export async function downloadAssetFile(assetId: string, fallbackName: string) {
  const token = await getBackendToken();
  const response = await requestBlob(`/assets/${assetId}/download`, undefined, token);
  const blob = await response.blob();
  const fileName = extractFileName(response.headers.get("Content-Disposition"), fallbackName);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
