export type ProviderWireApi = 'openai-chat' | 'anthropic-messages';
export type ModelTaskKey = 'default' | 'tenderParse' | 'outlineGenerate' | 'sectionGenerate';

export interface ModelProviderConfig {
  id: string;
  label: string;
  vendor: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  wireApi: ProviderWireApi;
  enabled: boolean;
}

export interface ModelTaskRouting {
  defaultProviderId: string;
  tenderParseProviderId: string;
  outlineGenerateProviderId: string;
  sectionGenerateProviderId: string;
}

export interface ModelConfigPayload {
  codingPlan: string;
  codingPlanUrl: string;
  codingPlanApiKey: string;
  codingPlanAppId: string;
  supportedModels: string[];
  activeProviderId: string;
  providers: ModelProviderConfig[];
  taskRouting: ModelTaskRouting;
}

export interface MaskedModelProviderConfig extends Omit<ModelProviderConfig, 'apiKey'> {
  apiKey?: string;
}

export interface MaskedModelConfigPayload extends Omit<ModelConfigPayload, 'providers' | 'codingPlanApiKey'> {
  codingPlanApiKey?: string;
  providers: MaskedModelProviderConfig[];
}

const DEFAULT_PROVIDER_ID = 'default-openai';

function maskKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length < 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function inferProviderWireApi(input: { vendor?: string; label?: string; wireApi?: unknown }): ProviderWireApi {
  if (input.wireApi === 'anthropic-messages') {
    return 'anthropic-messages';
  }
  if (input.wireApi === 'openai-chat' || input.wireApi === 'chat') {
    return 'openai-chat';
  }

  const vendor = input.vendor?.trim().toLowerCase();
  const label = input.label?.trim().toLowerCase();
  if (vendor === 'anthropic' || label?.includes('claude')) {
    return 'anthropic-messages';
  }
  return 'openai-chat';
}

function buildLegacyProviders(raw: Record<string, unknown>) {
  const selectedModel = typeof raw.selectedModel === 'string' ? raw.selectedModel : '';
  const providers: ModelProviderConfig[] = [];

  const pushProvider = (
    id: string,
    label: string,
    vendor: string,
    baseUrl: string,
    apiKey: unknown,
    model: string,
    wireApi?: ProviderWireApi,
  ) => {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return;
    }
    providers.push({
      id,
      label,
      vendor,
      baseUrl,
      apiKey: apiKey.trim(),
      model,
      wireApi: wireApi ?? inferProviderWireApi({ vendor, label }),
      enabled: true,
    });
  };

  pushProvider(
    'openai-default',
    'OpenAI',
    'openai',
    'https://api.openai.com/v1',
    raw.openaiKey,
    selectedModel.startsWith('gpt') ? selectedModel : 'gpt-4o',
  );
  pushProvider(
    'claude-default',
    'Claude',
    'anthropic',
    'https://api.anthropic.com/v1',
    raw.claudeKey,
    selectedModel.startsWith('claude') ? selectedModel : 'claude-sonnet-4-20250514',
    'anthropic-messages',
  );
  pushProvider(
    'qwen-default',
    '通义千问',
    'qwen',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    raw.qwenKey,
    selectedModel.startsWith('qwen') ? selectedModel : 'qwen-plus',
  );
  pushProvider(
    'deepseek-default',
    'DeepSeek',
    'deepseek',
    'https://api.deepseek.com/v1',
    raw.deepseekKey,
    selectedModel.startsWith('deepseek') ? selectedModel : 'deepseek-chat',
  );
  pushProvider(
    'doubao-default',
    '豆包',
    'doubao',
    'https://ark.cn-beijing.volces.com/api/v3',
    raw.doubaoKey,
    selectedModel.startsWith('doubao') ? selectedModel : 'doubao-seed-1-6-250615',
  );
  pushProvider(
    'minimax-default',
    'MiniMax',
    'minimax',
    'https://api.minimaxi.com/v1',
    raw.minimaxKey,
    selectedModel.toLowerCase().includes('minimax') ? selectedModel : 'MiniMax-M2.5',
  );
  pushProvider(
    'kimi-default',
    'Kimi',
    'kimi',
    'https://api.moonshot.cn/v1',
    raw.kimiKey,
    selectedModel.toLowerCase().includes('kimi') ? selectedModel : 'kimi-k2.5',
  );
  pushProvider(
    'zhipu-default',
    '智谱',
    'zhipu',
    'https://open.bigmodel.cn/api/paas/v4',
    raw.zhipuKey,
    selectedModel.toLowerCase().includes('glm') ? selectedModel : 'glm-4-air',
  );

  return providers;
}

function buildDefaultProvider(): ModelProviderConfig {
  return {
    id: DEFAULT_PROVIDER_ID,
    label: 'OpenAI Compatible',
    vendor: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    wireApi: 'openai-chat',
    enabled: true,
  };
}

export function normalizeModelConfig(rawValue: unknown): ModelConfigPayload {
  const raw = (rawValue && typeof rawValue === 'object' ? rawValue : {}) as Record<string, unknown>;
  const rawProviders = Array.isArray(raw.providers) ? raw.providers : buildLegacyProviders(raw);

  const providers = rawProviders
    .map((entry, index): ModelProviderConfig | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `provider-${index + 1}`;
      const baseUrl =
        typeof record.baseUrl === 'string' && record.baseUrl.trim()
          ? record.baseUrl.trim().replace(/\/+$/, '')
          : 'https://api.openai.com/v1';

      return {
        id,
        label: typeof record.label === 'string' && record.label.trim() ? record.label.trim() : id,
        vendor: typeof record.vendor === 'string' && record.vendor.trim() ? record.vendor.trim() : 'openai-compatible',
        baseUrl,
        apiKey: typeof record.apiKey === 'string' ? record.apiKey.trim() : '',
        model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : 'gpt-4o-mini',
        wireApi: inferProviderWireApi({
          vendor: typeof record.vendor === 'string' ? record.vendor : undefined,
          label: typeof record.label === 'string' ? record.label : undefined,
          wireApi: record.wireApi,
        }),
        enabled: record.enabled !== false,
      };
    })
    .filter((entry): entry is ModelProviderConfig => Boolean(entry));

  const ensuredProviders = providers.length > 0 ? providers : [buildDefaultProvider()];
  const activeProviderIdRaw =
    typeof raw.activeProviderId === 'string' && raw.activeProviderId.trim() ? raw.activeProviderId.trim() : undefined;
  const enabledProviderIds = ensuredProviders.filter((provider) => provider.enabled).map((provider) => provider.id);
  const activeProviderId =
    (activeProviderIdRaw && enabledProviderIds.includes(activeProviderIdRaw) ? activeProviderIdRaw : undefined) ??
    enabledProviderIds[0] ??
    ensuredProviders[0].id;

  const taskRoutingRecord =
    raw.taskRouting && typeof raw.taskRouting === 'object'
      ? (raw.taskRouting as Record<string, unknown>)
      : {};

  const taskRouting: ModelTaskRouting = {
    defaultProviderId:
      typeof taskRoutingRecord.defaultProviderId === 'string' && taskRoutingRecord.defaultProviderId.trim()
        ? taskRoutingRecord.defaultProviderId.trim()
        : activeProviderId,
    tenderParseProviderId:
      typeof taskRoutingRecord.tenderParseProviderId === 'string' && taskRoutingRecord.tenderParseProviderId.trim()
        ? taskRoutingRecord.tenderParseProviderId.trim()
        : activeProviderId,
    outlineGenerateProviderId:
      typeof taskRoutingRecord.outlineGenerateProviderId === 'string' && taskRoutingRecord.outlineGenerateProviderId.trim()
        ? taskRoutingRecord.outlineGenerateProviderId.trim()
        : activeProviderId,
    sectionGenerateProviderId:
      typeof taskRoutingRecord.sectionGenerateProviderId === 'string' && taskRoutingRecord.sectionGenerateProviderId.trim()
        ? taskRoutingRecord.sectionGenerateProviderId.trim()
        : activeProviderId,
  };

  return {
    codingPlan: typeof raw.codingPlan === 'string' ? raw.codingPlan : '',
    codingPlanUrl: typeof raw.codingPlanUrl === 'string' ? raw.codingPlanUrl.trim() : '',
    codingPlanApiKey:
      typeof raw.codingPlanApiKey === 'string'
        ? raw.codingPlanApiKey.trim()
        : typeof raw.codingPlanKey === 'string'
          ? raw.codingPlanKey.trim()
          : '',
    codingPlanAppId: typeof raw.codingPlanAppId === 'string' ? raw.codingPlanAppId.trim() : '',
    supportedModels:
      Array.isArray(raw.supportedModels)
        ? raw.supportedModels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : typeof raw.selectedModel === 'string' && raw.selectedModel.trim()
          ? [raw.selectedModel.trim()]
          : [],
    activeProviderId,
    providers: ensuredProviders,
    taskRouting,
  };
}

export function maskModelConfig(config: ModelConfigPayload): MaskedModelConfigPayload {
  return {
    ...config,
    codingPlanApiKey: maskKey(config.codingPlanApiKey),
    providers: config.providers.map((provider) => ({
      ...provider,
      apiKey: maskKey(provider.apiKey),
    })),
  };
}

export function resolveTaskProviderId(config: ModelConfigPayload, task: ModelTaskKey) {
  if (task === 'tenderParse') return config.taskRouting.tenderParseProviderId || config.activeProviderId;
  if (task === 'outlineGenerate') return config.taskRouting.outlineGenerateProviderId || config.activeProviderId;
  if (task === 'sectionGenerate') return config.taskRouting.sectionGenerateProviderId || config.activeProviderId;
  return config.taskRouting.defaultProviderId || config.activeProviderId;
}
