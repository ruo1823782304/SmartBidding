import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { verifyProviderConnection } from '../ai/provider-client';
import { ModelConfigDto } from './dto/model-config.dto';
import {
  inferProviderWireApi,
  maskModelConfig,
  ModelProviderConfig,
  normalizeModelConfig,
} from './settings.types';

const CONFIG_KEY = 'model_config';
const CODING_PLAN_OPENAI_MODELS = [
  'qwen3.5-plus',
  'kimi-k2.5',
  'glm-5',
  'MiniMax-M2.5',
  'qwen3-max-2026-01-23',
  'qwen3-coder-next',
  'qwen3-coder-plus',
  'glm-4.7',
];
const CODING_PLAN_OPENAI_PROBE_MODELS = ['qwen3.5-plus', 'qwen3-coder-plus', 'glm-5'];

function extractJsonText(raw: string) {
  const trimmed = raw.replace(/```json\s*|```/gi, '').trim();
  if (!trimmed) return '';
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  const startCandidates = [firstBrace, firstBracket].filter((value) => value >= 0);
  if (startCandidates.length === 0) {
    return trimmed;
  }
  const start = Math.min(...startCandidates);
  const endBrace = trimmed.lastIndexOf('}');
  const endBracket = trimmed.lastIndexOf(']');
  const end = Math.max(endBrace, endBracket);
  if (end <= start) {
    return trimmed.slice(start);
  }
  return trimmed.slice(start, end + 1);
}

function isMaskedSecret(value: string | undefined) {
  return Boolean(value && value.includes('****'));
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getModelConfig() {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    return maskModelConfig(normalizeModelConfig(row?.value));
  }

  async getModelConfigRaw() {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    return normalizeModelConfig(row?.value);
  }

  async setModelConfig(dto: ModelConfigDto) {
    const current = await this.getModelConfigRaw();
    const nextProviders = dto.providers
      ? this.mergeProviders(current.providers, dto.providers as ModelProviderConfig[])
      : current.providers;
    const nextCodingPlanApiKey =
      dto.codingPlanApiKey === undefined
        ? current.codingPlanApiKey
        : this.mergeSecretValue(dto.codingPlanApiKey, current.codingPlanApiKey);

    const next = normalizeModelConfig({
      ...current,
      ...(dto.codingPlan !== undefined ? { codingPlan: dto.codingPlan } : {}),
      ...(dto.codingPlanUrl !== undefined ? { codingPlanUrl: dto.codingPlanUrl } : {}),
      ...(dto.codingPlanAppId !== undefined ? { codingPlanAppId: dto.codingPlanAppId } : {}),
      ...(dto.supportedModels !== undefined ? { supportedModels: dto.supportedModels } : {}),
      ...(dto.codingPlanApiKey !== undefined ? { codingPlanApiKey: nextCodingPlanApiKey } : {}),
      ...(dto.activeProviderId !== undefined ? { activeProviderId: dto.activeProviderId } : {}),
      ...(dto.providers !== undefined ? { providers: nextProviders } : {}),
      ...(dto.taskRouting !== undefined ? { taskRouting: { ...current.taskRouting, ...dto.taskRouting } } : {}),
    });

    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });

    return { success: true, config: maskModelConfig(next) };
  }

  async verifyProvider(input: ModelProviderConfig) {
    const current = await this.getModelConfigRaw();
    const currentProvider = current.providers.find((item) => item.id === input.id);
    const provider: ModelProviderConfig = {
      id: input.id?.trim() || currentProvider?.id || 'provider-verify',
      label: input.label?.trim() || currentProvider?.label || input.id || 'provider-verify',
      vendor: input.vendor?.trim() || currentProvider?.vendor || 'openai-compatible',
      baseUrl: (input.baseUrl?.trim() || currentProvider?.baseUrl || '').replace(/\/+$/, ''),
      apiKey: this.mergeSecretValue(input.apiKey, currentProvider?.apiKey),
      model: input.model?.trim() || currentProvider?.model || '',
      wireApi: inferProviderWireApi({
        vendor: input.vendor || currentProvider?.vendor,
        label: input.label || currentProvider?.label,
        wireApi: input.wireApi || currentProvider?.wireApi,
      }),
      enabled: input.enabled !== false,
    };

    if (!provider.baseUrl) {
      throw new BadRequestException('当前供应商 API 端点不能为空。');
    }

    return verifyProviderConnection(provider);
  }

  async parseCodingPlan(url: string, apiKey: string) {
    const current = await this.getModelConfigRaw();
    const normalizedUrl = url?.trim() || current.codingPlanUrl?.trim();
    const providedKey = apiKey?.trim();
    const normalizedKey = !providedKey || isMaskedSecret(providedKey) ? current.codingPlanApiKey?.trim() : providedKey;

    if (!normalizedUrl || !normalizedKey) {
      throw new BadRequestException('Coding Plan URL 和 API-Key 不能为空。');
    }

    if (this.isDashscopeCodingPlanOpenAiUrl(normalizedUrl)) {
      return this.parseDashscopeCodingPlanOpenAi(normalizedUrl, normalizedKey);
    }

    const appId = this.extractBailianAppId(normalizedUrl);
    if (!appId) {
      throw new BadRequestException('当前仅支持阿里云百炼应用 URL / 应用 ID，或 Coding Plan OpenAI 兼容 Base URL。');
    }

    const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/apps/${encodeURIComponent(appId)}/completion`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalizedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: [
            '你是 Coding Plan 信息提取助手。',
            '请只返回 JSON，不要输出解释。',
            '格式：{"supportedModels":["gpt-4o","claude-sonnet-4-20250514","deepseek-chat","doubao-seed-1-6-250615","qwen-plus","kimi-k2.5","MiniMax-M2.5","glm-4-air"],"summary":"不超过120字的中文总结"}。',
            'supportedModels 只能填写当前应用明确支持或可直接路由的模型；如果无法确认，请返回空数组。',
          ].join('\n'),
        },
      }),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new BadRequestException(`Coding Plan 调用失败：${rawText || response.statusText}`);
    }

    const rawPayload = this.safeParseJson(rawText);
    const parsed = this.parseCodingPlanResponse(rawPayload ?? rawText);
    return {
      success: true,
      provider: 'bailian',
      appId,
      supportedModels: parsed.supportedModels,
      summary: parsed.summary,
      rawText: typeof rawPayload === 'object' ? JSON.stringify(rawPayload) : rawText,
    };
  }

  private async parseDashscopeCodingPlanOpenAi(url: string, apiKey: string) {
    const baseUrl = url.replace(/\/+$/, '');
    const probe = await this.probeCodingPlanOpenAi(baseUrl, apiKey);

    return {
      success: true,
      provider: 'dashscope-coding-plan-openai',
      appId: 'coding-plan-openai',
      supportedModels: [...CODING_PLAN_OPENAI_MODELS],
      summary: `Coding Plan OpenAI 兼容地址校验通过，探测模型：${probe.model}`,
      rawText: JSON.stringify({ probeModel: probe.model, responseModel: probe.responseModel }),
    };
  }

  private mergeProviders(currentProviders: ModelProviderConfig[], incomingProviders: ModelProviderConfig[]) {
    const currentMap = new Map(currentProviders.map((provider) => [provider.id, provider]));
    return incomingProviders.map((provider) => {
      const current = currentMap.get(provider.id);
      return {
        ...provider,
        baseUrl: provider.baseUrl.trim().replace(/\/+$/, ''),
        wireApi: inferProviderWireApi(provider),
        apiKey: this.mergeSecretValue(provider.apiKey, current?.apiKey),
      };
    });
  }

  private mergeSecretValue(nextValue: string | undefined, currentValue?: string) {
    if (nextValue === undefined) {
      return currentValue ?? '';
    }
    const trimmed = nextValue.trim();
    if (isMaskedSecret(trimmed) && currentValue) {
      return currentValue;
    }
    return trimmed;
  }

  private extractBailianAppId(input: string) {
    const directId = input.match(/^[a-zA-Z0-9_-]{6,}$/)?.[0];
    if (directId && !input.includes('/')) {
      return directId;
    }

    try {
      const url = new URL(input);
      const pathMatch = url.pathname.match(/\/api\/v1\/apps\/([^/]+)\/completion/i);
      if (pathMatch?.[1]) {
        return pathMatch[1];
      }
      const hashMatch = url.hash.match(/(?:app|application|applications|agent|workflow)[/=]([a-zA-Z0-9_-]{6,})/i);
      if (hashMatch?.[1]) {
        return hashMatch[1];
      }
      return (
        url.searchParams.get('appId') ||
        url.searchParams.get('app_id') ||
        url.searchParams.get('applicationId') ||
        url.searchParams.get('application_id') ||
        ''
      );
    } catch {
      return '';
    }
  }

  private isDashscopeCodingPlanOpenAiUrl(input: string) {
    try {
      const url = new URL(input);
      const normalizedPath = url.pathname.replace(/\/+$/, '');
      return url.hostname === 'coding.dashscope.aliyuncs.com' && normalizedPath === '/v1';
    } catch {
      return false;
    }
  }

  private async probeCodingPlanOpenAi(baseUrl: string, apiKey: string) {
    let lastError = '';

    for (const model of CODING_PLAN_OPENAI_PROBE_MODELS) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
          temperature: 0,
        }),
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastError = rawText || response.statusText;
        continue;
      }

      const payload = this.safeParseJson(rawText) as { model?: unknown } | null;
      return {
        model,
        responseModel: typeof payload?.model === 'string' ? payload.model : model,
      };
    }

    throw new BadRequestException(`Coding Plan OpenAI 兼容地址校验失败：${lastError || '无法完成模型探测。'}`);
  }

  private parseCodingPlanResponse(rawPayload: unknown) {
    const outputText = this.extractDashscopeOutputText(rawPayload);
    const parsedPayload = JSON.parse(extractJsonText(outputText)) as {
      supportedModels?: unknown;
      summary?: unknown;
    };
    const supportedModels = Array.isArray(parsedPayload.supportedModels)
      ? parsedPayload.supportedModels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const summary =
      typeof parsedPayload.summary === 'string' && parsedPayload.summary.trim()
        ? parsedPayload.summary.trim()
        : outputText.slice(0, 120);
    return {
      supportedModels,
      summary,
    };
  }

  private extractDashscopeOutputText(rawPayload: unknown) {
    if (typeof rawPayload === 'string') {
      return rawPayload.trim();
    }
    if (!rawPayload || typeof rawPayload !== 'object') {
      return '';
    }

    const payload = rawPayload as {
      output?: {
        text?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
      };
    };

    if (typeof payload.output?.text === 'string') {
      return payload.output.text.trim();
    }

    const choiceContent = payload.output?.choices?.[0]?.message?.content;
    if (typeof choiceContent === 'string') {
      return choiceContent.trim();
    }
    if (Array.isArray(choiceContent)) {
      return choiceContent
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
            return item.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    return '';
  }

  private safeParseJson(rawText: string) {
    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      return null;
    }
  }
}
