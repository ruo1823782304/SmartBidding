import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class AiService {
  constructor(private readonly settings: SettingsService) {}

  private async getClient(): Promise<OpenAI | null> {
    const config = await this.settings.getModelConfigRaw();
    const model = config.selectedModel || 'openai';
    let apiKey = config.openaiKey;
    let baseURL: string | undefined;
    if (model === 'qwen' && config.qwenKey) {
      apiKey = config.qwenKey;
      baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    } else if (model === 'deepseek' && config.deepseekKey) {
      apiKey = config.deepseekKey;
      baseURL = 'https://api.deepseek.com/v1';
    }
    if (!apiKey) return null;
    return new OpenAI({ apiKey, baseURL });
  }

  async chat(systemPrompt: string, userContent: string): Promise<string> {
    const client = await this.getClient();
    if (!client) return '';
    try {
      const config = await this.settings.getModelConfigRaw();
      const modelName =
        config.selectedModel === 'qwen'
          ? 'qwen-turbo'
          : config.selectedModel === 'deepseek'
            ? 'deepseek-chat'
            : 'gpt-3.5-turbo';
      const completion = await client.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 4096,
      });
      return completion.choices[0]?.message?.content?.trim() ?? '';
    } catch (e) {
      console.error('AI chat error', e);
      return '';
    }
  }

  /** 根据招标要求生成应标大纲（技术标/商务标分组与章节） */
  async generateOutline(projectId: string, tenderSummary?: string): Promise<Array<{ group: string; sections: Array<{ name: string; detail?: string }> }>> {
    const prompt = `你是一个标书编制专家。根据以下招标要求摘要，生成应标大纲。要求：
1. 分为技术标和商务标两大部分。
2. 技术标包含：总体技术方案、技术实施方案、质量保证、服务承诺等常见章节。
3. 商务标包含：资信证明、报价、业绩、人员等。
4. 返回 JSON 数组，每项格式：{"group":"分组名","sections":[{"name":"章节名","detail":"简要说明"}]}
只返回 JSON，不要其他说明。`;
    const input = tenderSummary || '请生成一份通用的投标文件大纲（技术标+商务标）。';
    const raw = await this.chat(prompt, input);
    try {
      const json = raw.replace(/```json?\s*|\s*```/g, '').trim();
      return JSON.parse(json) as Array<{ group: string; sections: Array<{ name: string; detail?: string }> }>;
    } catch {
      return [
        { group: '技术标', sections: [{ name: '总体技术方案', detail: '' }, { name: '技术实施方案', detail: '' }] },
        { group: '商务标', sections: [{ name: '资信证明', detail: '' }, { name: '报价清单', detail: '' }] },
      ];
    }
  }

  /** 根据章节名与上下文生成标书段落内容（AI 拟写） */
  async generateSectionContent(sectionName: string, context?: string): Promise<string> {
    const system = `你是标书撰写专家。根据用户给出的章节名称和可选上下文，撰写该章节的正式、专业的标书内容。内容应条理清晰、符合招投标规范。若为富文本，可用简单 HTML 标签如 <p>、<ul>、<li>。`;
    const user = context
      ? `章节：${sectionName}\n\n参考或要求：\n${context}`
      : `请为「${sectionName}」撰写一段标书正文内容。`;
    return this.chat(system, user);
  }
}
