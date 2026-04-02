import { buildBackendNetworkHint, resolveBackendApiBase } from "./backend-base";

const API_BASE = resolveBackendApiBase(import.meta.env.VITE_TENDER_BACKEND_BASE_URL, "/api");
const BACKEND_USERNAME = import.meta.env.VITE_TENDER_BACKEND_USERNAME ?? "admin";
const BACKEND_PASSWORD = import.meta.env.VITE_TENDER_BACKEND_PASSWORD ?? "admin123";
const TOKEN_STORAGE_KEY = "smart-bidding.backend-token";

export type ProviderWireApi = "openai-chat" | "anthropic-messages";
export type ModelProvider = "OpenAI" | "Claude" | "DeepSeek" | "豆包" | "通义千问" | "MiniMax" | "Kimi" | "智谱";
export type ModelConfigKeyField =
  | "openaiKey"
  | "claudeKey"
  | "deepseekKey"
  | "doubaoKey"
  | "qwenKey"
  | "minimaxKey"
  | "kimiKey"
  | "zhipuKey";

export type ModelConfig = {
  codingPlanUrl: string;
  codingPlanKey: string;
  codingPlanAppId: string;
  codingPlanSummary: string;
  selectedModel: string;
  activeProvider: ModelProvider;
  appliedProvider: ModelProvider;
  supportedModels: string[];
  openaiKey: string;
  claudeKey: string;
  qwenKey: string;
  deepseekKey: string;
  doubaoKey: string;
  minimaxKey: string;
  kimiKey: string;
  zhipuKey: string;
};

export type ProviderConfigMeta = {
  id: string;
  provider: ModelProvider;
  vendor: string;
  vendorLabel: string;
  identifier: string;
  officialUrl: string;
  baseUrl: string;
  wireApi: ProviderWireApi;
  protocolLabel: string;
  model: string;
  models: string[];
  aliases: string[];
  keyField: ModelConfigKeyField;
  placeholder: string;
  description: string;
};

type BackendProviderConfig = {
  id: string;
  label: string;
  vendor: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  wireApi?: ProviderWireApi | "chat";
  enabled: boolean;
};

type BackendModelConfig = {
  codingPlan?: string;
  codingPlanUrl?: string;
  codingPlanApiKey?: string;
  codingPlanAppId?: string;
  supportedModels?: string[];
  activeProviderId?: string;
  providers?: BackendProviderConfig[];
};

type ParseCodingPlanResponse = {
  success: boolean;
  provider: string;
  appId: string;
  supportedModels: string[];
  summary: string;
  rawText: string;
};

export type VerifyProviderResponse = {
  success: boolean;
  providerId: string;
  providerLabel: string;
  wireApi: ProviderWireApi;
  model: string;
  responseModel: string;
  summary: string;
};

const PROVIDER_ID_BY_NAME: Record<ModelProvider, string> = {
  OpenAI: "openai-default",
  Claude: "claude-default",
  DeepSeek: "deepseek-default",
  豆包: "doubao-default",
  通义千问: "qwen-default",
  MiniMax: "minimax-default",
  Kimi: "kimi-default",
  智谱: "zhipu-default",
};

const PROVIDER_NAME_BY_ID = Object.fromEntries(
  Object.entries(PROVIDER_ID_BY_NAME).map(([provider, id]) => [id, provider as ModelProvider]),
) as Record<string, ModelProvider>;

export const AI_PROVIDER_CONFIGS: ProviderConfigMeta[] = [
  {
    id: "openai-default",
    provider: "OpenAI",
    vendor: "openai",
    vendorLabel: "OpenAI",
    identifier: "openai-default",
    officialUrl: "https://platform.openai.com/",
    baseUrl: "https://api.openai.com/v1",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini"],
    aliases: ["openai", "gpt", "4o"],
    keyField: "openaiKey",
    placeholder: "请输入 OpenAI API-Key",
    description: "OpenAI 官方接口，适合通用生成与分析任务。",
  },
  {
    id: "claude-default",
    provider: "Claude",
    vendor: "anthropic",
    vendorLabel: "Anthropic",
    identifier: "claude-default",
    officialUrl: "https://console.anthropic.com/",
    baseUrl: "https://api.anthropic.com/v1",
    wireApi: "anthropic-messages",
    protocolLabel: "Anthropic Messages",
    model: "claude-sonnet-4-20250514",
    models: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219"],
    aliases: ["claude", "anthropic", "sonnet", "opus", "haiku"],
    keyField: "claudeKey",
    placeholder: "请输入 Claude API-Key",
    description: "Anthropic 原生 Messages 协议，适合长文理解与写作。",
  },
  {
    id: "deepseek-default",
    provider: "DeepSeek",
    vendor: "deepseek",
    vendorLabel: "DeepSeek",
    identifier: "deepseek-default",
    officialUrl: "https://platform.deepseek.com/",
    baseUrl: "https://api.deepseek.com/v1",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    aliases: ["deepseek"],
    keyField: "deepseekKey",
    placeholder: "请输入 DeepSeek API-Key",
    description: "DeepSeek OpenAI 兼容接口，适合通用问答与推理。",
  },
  {
    id: "doubao-default",
    provider: "豆包",
    vendor: "doubao",
    vendorLabel: "火山方舟",
    identifier: "doubao-default",
    officialUrl: "https://www.volcengine.com/product/ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "doubao-seed-1-6-250615",
    models: ["doubao-seed-1-6-250615", "doubao-1-5-pro-32k-250115"],
    aliases: ["doubao", "豆包", "ark"],
    keyField: "doubaoKey",
    placeholder: "请输入 豆包 API-Key",
    description: "火山方舟 OpenAI 兼容接口，适合中文内容生成。",
  },
  {
    id: "qwen-default",
    provider: "通义千问",
    vendor: "qwen",
    vendorLabel: "阿里云百炼",
    identifier: "qwen-default",
    officialUrl: "https://bailian.console.aliyun.com/",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen3-max-2026-01-23"],
    aliases: ["qwen", "tongyi", "通义"],
    keyField: "qwenKey",
    placeholder: "请输入 通义千问 API-Key",
    description: "阿里云百炼兼容模式，适合中文理解与结构化抽取。",
  },
  {
    id: "minimax-default",
    provider: "MiniMax",
    vendor: "minimax",
    vendorLabel: "MiniMax",
    identifier: "minimax-default",
    officialUrl: "https://platform.minimaxi.com/",
    baseUrl: "https://api.minimaxi.com/v1",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "MiniMax-M2.5",
    models: ["MiniMax-M2.5", "MiniMax-M2.1"],
    aliases: ["minimax", "m2.5", "m2.1"],
    keyField: "minimaxKey",
    placeholder: "请输入 MiniMax API-Key",
    description: "MiniMax OpenAI 兼容接口，适合长文本与多轮对话。",
  },
  {
    id: "kimi-default",
    provider: "Kimi",
    vendor: "kimi",
    vendorLabel: "Moonshot AI",
    identifier: "kimi-default",
    officialUrl: "https://platform.moonshot.cn/",
    baseUrl: "https://api.moonshot.cn/v1",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "kimi-k2.5",
    models: ["kimi-k2.5", "moonshot-v1-32k"],
    aliases: ["kimi", "moonshot", "k2.5", "k2"],
    keyField: "kimiKey",
    placeholder: "请输入 Kimi API-Key",
    description: "Moonshot OpenAI 兼容接口，适合中文文档分析。",
  },
  {
    id: "zhipu-default",
    provider: "智谱",
    vendor: "zhipu",
    vendorLabel: "智谱 AI",
    identifier: "zhipu-default",
    officialUrl: "https://open.bigmodel.cn/",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    wireApi: "openai-chat",
    protocolLabel: "OpenAI Chat Completions",
    model: "glm-4-air",
    models: ["glm-4-air", "glm-4.5-air", "glm-5"],
    aliases: ["zhipu", "glm", "bigmodel", "智谱"],
    keyField: "zhipuKey",
    placeholder: "请输入 智谱 API-Key",
    description: "智谱兼容 OpenAI 调用方式，适合中文生成与推理。",
  },
];

export function buildEmptyModelConfig(): ModelConfig {
  return {
    codingPlanUrl: "",
    codingPlanKey: "",
    codingPlanAppId: "",
    codingPlanSummary: "",
    selectedModel: AI_PROVIDER_CONFIGS[0].model,
    activeProvider: "OpenAI",
    appliedProvider: "OpenAI",
    supportedModels: [],
    openaiKey: "",
    claudeKey: "",
    qwenKey: "",
    deepseekKey: "",
    doubaoKey: "",
    minimaxKey: "",
    kimiKey: "",
    zhipuKey: "",
  };
}

export function getProviderConfig(provider: ModelProvider) {
  return AI_PROVIDER_CONFIGS.find((item) => item.provider === provider) ?? AI_PROVIDER_CONFIGS[0];
}

export function inferProviderByModel(model: string): ModelProvider {
  const normalized = model.trim().toLowerCase();
  const matched = AI_PROVIDER_CONFIGS.find(
    (item) =>
      item.model.toLowerCase() === normalized ||
      item.models.some((candidate) => candidate.toLowerCase() === normalized) ||
      item.aliases.some((alias) => normalized.includes(alias.toLowerCase())),
  );
  return matched?.provider ?? "OpenAI";
}

export function buildProviderPreviewJson(provider: ProviderConfigMeta, apiKey: string, selectedModel: string) {
  const preview = {
    baseUrl: provider.baseUrl,
    apiKey: apiKey ? "已填写" : "",
    api: provider.wireApi,
    models: provider.models.map((item) => ({
      id: item,
      name: item,
      enabled: item === selectedModel,
    })),
  };
  return JSON.stringify(preview, null, 2);
}

async function requestJson<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown network error";
    throw new Error(
      `后端服务不可达：${API_BASE}${path}。请确认当前仓库后端已启动，并监听正确端口。${buildBackendNetworkHint(API_BASE)} 原始错误：${message}`,
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function getBackendToken() {
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

function mapBackendConfigToFrontend(config?: BackendModelConfig): ModelConfig {
  const next = buildEmptyModelConfig();
  const providers = config?.providers ?? [];
  const appliedProvider = PROVIDER_NAME_BY_ID[config?.activeProviderId ?? ""] ?? "OpenAI";
  const appliedProviderConfig =
    providers.find((item) => item.id === (config?.activeProviderId ?? "")) ??
    providers.find((item) => item.id === getProviderConfig(appliedProvider).id);

  next.codingPlanUrl = config?.codingPlanUrl?.trim() ?? "";
  next.codingPlanKey = config?.codingPlanApiKey?.trim() ?? "";
  next.codingPlanAppId = config?.codingPlanAppId?.trim() ?? "";
  next.codingPlanSummary = config?.codingPlan?.trim() ?? "";
  next.supportedModels = Array.isArray(config?.supportedModels) ? config.supportedModels.filter(Boolean) : [];
  next.appliedProvider = appliedProvider;
  next.activeProvider = appliedProvider;
  next.selectedModel = appliedProviderConfig?.model?.trim() || next.supportedModels[0] || getProviderConfig(appliedProvider).model;

  providers.forEach((provider) => {
    const providerName = PROVIDER_NAME_BY_ID[provider.id];
    const localProvider = providerName ? getProviderConfig(providerName) : null;
    if (!localProvider) {
      return;
    }
    next[localProvider.keyField] = provider.apiKey?.trim() ?? "";
  });

  return next;
}

function buildProvidersPayload(config: ModelConfig) {
  const selectedProvider = inferProviderByModel(config.selectedModel);
  return AI_PROVIDER_CONFIGS.map((item) => ({
    id: item.id,
    label: item.provider,
    vendor: item.vendor,
    baseUrl: item.baseUrl,
    apiKey: config[item.keyField],
    model: selectedProvider === item.provider ? config.selectedModel : item.model,
    wireApi: item.wireApi,
    enabled: Boolean(config[item.keyField].trim()) || item.provider === config.appliedProvider,
  }));
}

function buildActiveProviderPayload(config: ModelConfig) {
  const provider = getProviderConfig(config.activeProvider);
  return {
    id: provider.id,
    label: provider.provider,
    vendor: provider.vendor,
    baseUrl: provider.baseUrl,
    apiKey: config[provider.keyField],
    model: config.selectedModel || provider.model,
    wireApi: provider.wireApi,
    enabled: true,
  };
}

export async function loadRemoteModelConfig() {
  const token = await getBackendToken();
  const config = await requestJson<BackendModelConfig>("/settings/model", undefined, token);
  return mapBackendConfigToFrontend(config);
}

export async function parseRemoteCodingPlan(url: string, apiKey: string) {
  const token = await getBackendToken();
  return requestJson<ParseCodingPlanResponse>(
    "/settings/model/coding-plan/parse",
    {
      method: "POST",
      body: JSON.stringify({ url, apiKey }),
    },
    token,
  );
}

export async function verifyRemoteProviderConfig(config: ModelConfig) {
  const token = await getBackendToken();
  return requestJson<VerifyProviderResponse>(
    "/settings/model/verify",
    {
      method: "POST",
      body: JSON.stringify(buildActiveProviderPayload(config)),
    },
    token,
  );
}

export async function saveRemoteModelConfig(config: ModelConfig, options?: { apply?: boolean }) {
  const apply = options?.apply ?? false;
  const effectiveAppliedProvider = apply ? config.activeProvider : config.appliedProvider;
  const providerId = PROVIDER_ID_BY_NAME[effectiveAppliedProvider];
  const token = await getBackendToken();
  const response = await requestJson<{ success: boolean; config: BackendModelConfig }>(
    "/settings/model",
    {
      method: "PUT",
      body: JSON.stringify({
        codingPlan: config.codingPlanSummary,
        codingPlanUrl: config.codingPlanUrl,
        codingPlanApiKey: config.codingPlanKey,
        codingPlanAppId: config.codingPlanAppId,
        supportedModels: config.supportedModels,
        activeProviderId: providerId,
        providers: buildProvidersPayload({ ...config, appliedProvider: effectiveAppliedProvider }),
        taskRouting: {
          defaultProviderId: providerId,
          tenderParseProviderId: providerId,
          outlineGenerateProviderId: providerId,
          sectionGenerateProviderId: providerId,
        },
      }),
    },
    token,
  );

  const next = mapBackendConfigToFrontend(response.config);
  if (!apply) {
    return {
      ...next,
      activeProvider: config.activeProvider,
      selectedModel: config.selectedModel,
    };
  }
  return next;
}
