import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CONFIG_KEY = 'model_config';

function maskKey(key: string | undefined): string | undefined {
  if (!key || key.length < 8) return key ? '****' : undefined;
  return key.slice(0, 4) + '****' + key.slice(-4);
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getModelConfig() {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const raw = (row?.value as Record<string, string>) ?? {};
    return {
      codingPlan: raw.codingPlan,
      selectedModel: raw.selectedModel,
      openaiKey: maskKey(raw.openaiKey),
      qwenKey: maskKey(raw.qwenKey),
      deepseekKey: maskKey(raw.deepseekKey),
      baichuanKey: maskKey(raw.baichuanKey),
    };
  }

  async getModelConfigRaw(): Promise<Record<string, string>> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    return (row?.value as Record<string, string>) ?? {};
  }

  async setModelConfig(dto: Record<string, string | undefined>) {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const current = (row?.value as Record<string, string>) ?? {};
    const next: Record<string, string> = { ...current };
    if (dto.codingPlan !== undefined) next.codingPlan = dto.codingPlan;
    if (dto.selectedModel !== undefined) next.selectedModel = dto.selectedModel;
    if (dto.openaiKey !== undefined) next.openaiKey = dto.openaiKey;
    if (dto.qwenKey !== undefined) next.qwenKey = dto.qwenKey;
    if (dto.deepseekKey !== undefined) next.deepseekKey = dto.deepseekKey;
    if (dto.baichuanKey !== undefined) next.baichuanKey = dto.baichuanKey;
    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: next },
      update: { value: next },
    });
    return { success: true };
  }
}
