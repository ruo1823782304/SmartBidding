const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string) {
  return LOCAL_HOSTS.has(hostname.trim().toLowerCase());
}

function buildLoopbackBase(url: URL, hostname: string) {
  const port = url.port || (url.protocol === "https:" ? "443" : "3001");
  return trimTrailingSlashes(`${url.protocol}//${hostname}:${port}${url.pathname}`);
}

export function resolveBackendApiBase(explicitBase?: string, fallbackBase = "/api") {
  const configuredBase = trimTrailingSlashes((explicitBase?.trim() || fallbackBase).trim());
  if (typeof window === "undefined") {
    return configuredBase;
  }

  if (!/^https?:\/\//i.test(configuredBase)) {
    return configuredBase;
  }

  try {
    const url = new URL(configuredBase);
    const pageHost = window.location.hostname.trim().toLowerCase();
    if (pageHost && isLoopbackHost(url.hostname) && !isLoopbackHost(pageHost) && window.location.protocol === "http:") {
      return buildLoopbackBase(url, pageHost);
    }
    return trimTrailingSlashes(`${url.origin}${url.pathname}`);
  } catch {
    return configuredBase;
  }
}

export function buildBackendNetworkHint(apiBase: string) {
  if (typeof window === "undefined" || !/^https?:\/\//i.test(apiBase)) {
    return "";
  }

  try {
    const url = new URL(apiBase);
    const pageHost = window.location.hostname.trim().toLowerCase();
    if (!pageHost) {
      return "";
    }

    if (window.location.protocol === "https:" && url.protocol === "http:") {
      return ` 当前页面为 HTTPS，但接口是 HTTP，浏览器可能会直接拦截该请求。`;
    }

    if (isLoopbackHost(url.hostname) && !isLoopbackHost(pageHost)) {
      return ` 当前页面主机为 ${pageHost}，但接口基址仍指向 ${url.hostname}，跨设备访问时这通常会失败。`;
    }
  } catch {
    return "";
  }

  return "";
}
