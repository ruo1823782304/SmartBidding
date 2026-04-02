import { BadRequestException } from '@nestjs/common';
import { ModelProviderConfig, ProviderWireApi } from '../settings/settings.types';

type ProviderTextResult = {
  wireApi: ProviderWireApi;
  model: string;
  responseModel: string;
  text: string;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

function extractOpenAiContent(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return '';
  }

  const payload = rawPayload as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
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

function extractAnthropicContent(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return '';
  }

  const payload = rawPayload as {
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  };

  return (payload.content ?? [])
    .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function callOpenAiCompatible(
  provider: ModelProviderConfig,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  temperature: number,
) {
  const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new BadRequestException(rawText || response.statusText || 'OpenAI compatible request failed.');
  }

  const payload = JSON.parse(rawText) as { model?: unknown };
  return {
    wireApi: 'openai-chat' as const,
    model: provider.model,
    responseModel: typeof payload.model === 'string' ? payload.model : provider.model,
    text: extractOpenAiContent(payload),
  };
}

async function callAnthropicMessages(
  provider: ModelProviderConfig,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  temperature: number,
) {
  const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: provider.model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new BadRequestException(rawText || response.statusText || 'Anthropic messages request failed.');
  }

  const payload = JSON.parse(rawText) as { model?: unknown };
  return {
    wireApi: 'anthropic-messages' as const,
    model: provider.model,
    responseModel: typeof payload.model === 'string' ? payload.model : provider.model,
    text: extractAnthropicContent(payload),
  };
}

export async function requestProviderText(
  provider: ModelProviderConfig,
  params: {
    systemPrompt: string;
    userContent: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<ProviderTextResult> {
  const maxTokens = params.maxTokens ?? 256;
  const temperature = params.temperature ?? 0;

  if (provider.wireApi === 'anthropic-messages') {
    return callAnthropicMessages(provider, params.systemPrompt, params.userContent, maxTokens, temperature);
  }

  return callOpenAiCompatible(provider, params.systemPrompt, params.userContent, maxTokens, temperature);
}

export async function verifyProviderConnection(provider: ModelProviderConfig) {
  if (!provider.apiKey?.trim()) {
    throw new BadRequestException('当前供应商 API-Key 不能为空。');
  }
  if (!provider.model?.trim()) {
    throw new BadRequestException('当前供应商模型不能为空。');
  }

  const result = await requestProviderText(provider, {
    systemPrompt: 'You are a connection verification assistant. Reply with the single word pong.',
    userContent: 'ping',
    maxTokens: 32,
    temperature: 0,
  });

  return {
    success: true,
    providerId: provider.id,
    providerLabel: provider.label,
    wireApi: result.wireApi,
    model: result.model,
    responseModel: result.responseModel,
    summary: `连接校验通过，已使用 ${result.responseModel} 成功返回响应。`,
  };
}
