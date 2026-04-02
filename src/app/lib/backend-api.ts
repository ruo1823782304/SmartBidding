import { buildBackendNetworkHint, resolveBackendApiBase } from "./backend-base";

const API_BASE = resolveBackendApiBase(import.meta.env.VITE_TENDER_BACKEND_BASE_URL, "/api");
const BACKEND_USERNAME = import.meta.env.VITE_TENDER_BACKEND_USERNAME ?? "admin";
const BACKEND_PASSWORD = import.meta.env.VITE_TENDER_BACKEND_PASSWORD ?? "admin123";
const TOKEN_STORAGE_KEY = "smart-bidding.backend-token";

function normalizeNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch/i.test(message) || /networkerror/i.test(message)) {
    return `无法连接到标书后端服务。请确认后端已启动：D:\\SmartBidding\\project\\backend\\scripts\\start-stack.ps1，当前接口基址为 ${API_BASE}.${buildBackendNetworkHint(API_BASE)}`;
  }
  return message;
}

export async function requestJson<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    throw new Error(normalizeNetworkError(error));
  }
}

export async function requestBlob(path: string, init?: RequestInit, token?: string) {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed: ${response.status}`);
    }

    return response;
  } catch (error) {
    throw new Error(normalizeNetworkError(error));
  }
}

export async function getBackendToken() {
  const cached = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (cached) {
    return cached;
  }

  const result = await requestJson<{ token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: BACKEND_USERNAME,
      password: BACKEND_PASSWORD,
    }),
  });
  sessionStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  return result.token;
}

export function getBackendUsername() {
  return BACKEND_USERNAME;
}

export { API_BASE };
