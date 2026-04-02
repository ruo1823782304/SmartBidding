import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { ModelProviderConfig, ModelTaskKey, resolveTaskProviderId } from '../settings/settings.types';
import { normalizeOutlineGroups, type OutlineGroup } from '../proposal/proposal-outline.util';
import { requestProviderText } from './provider-client';

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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly settings: SettingsService) {}

  async getTaskProvider(task: ModelTaskKey = 'default'): Promise<ModelProviderConfig | null> {
    const config = await this.settings.getModelConfigRaw();
    const providerId = resolveTaskProviderId(config, task);
    const provider =
      config.providers.find((item) => item.id === providerId && item.enabled) ??
      config.providers.find((item) => item.enabled);
    if (!provider?.apiKey) {
      return null;
    }
    return provider;
  }

  async getTaskCodingPlan(task: ModelTaskKey = 'default') {
    const config = await this.settings.getModelConfigRaw();
    const plan = config.codingPlan?.trim();
    if (!plan) {
      return '';
    }
    return `[CodingPlan:${task}]\n${plan}`;
  }

  async chatText(params: {
    task?: ModelTaskKey;
    systemPrompt: string;
    userContent: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const provider = await this.getTaskProvider(params.task);
    if (!provider) {
      return '';
    }

    const codingPlan = await this.getTaskCodingPlan(params.task);
    const systemPrompt = codingPlan ? `${codingPlan}\n\n${params.systemPrompt}` : params.systemPrompt;
    try {
      const result = await requestProviderText(provider, {
        systemPrompt,
        userContent: params.userContent,
        temperature: params.temperature ?? 0.2,
        maxTokens: params.maxTokens ?? 4096,
      });
      return result.text.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown AI error';
      this.logger.warn(`AI request failed for task ${params.task ?? 'default'}: ${message}`);
      return '';
    }
  }

  async chatJson<T>(params: {
    task?: ModelTaskKey;
    systemPrompt: string;
    userContent: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<T | null> {
    const text = await this.chatText(params);
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(extractJsonText(text)) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
      this.logger.warn(`AI JSON parse failed for task ${params.task ?? 'default'}: ${message}`);
      return null;
    }
  }

  async generateOutline(
    _projectId: string,
    tenderSummary?: string,
  ): Promise<OutlineGroup[]> {
    const prompt = `你是一个中国投标文件编制专家。请根据招标文件原文解析结果，生成可直接用于编制的投标文件结构。
输出要求：
1. 只输出 JSON 数组，不要输出 Markdown、解释或额外文字。
2. JSON 顶层必须包含“技术标”和“商务标”两个 group。
3. 每个 group 格式为 {"group":"技术标或商务标","sections":[...]}。
 4. sections 中每个节点格式为 {"id":"可选","title":"标题","detail":"该标题应写什么","sourceItemIds":["parse-item-id"],"sourceType":"tender|inferred|reference","children":[...]}。
 5. 必须支持通过 children 继续细分，最多可到 5 级标题；实质性技术章节默认展开到 3 级，不要只停留在空泛的 1 级标题。
 6. 结构必须以当前招标文件原文为主，不得套固定模板；只有在原文信息不足时，才能参考提供的常见目录建议做补盲。
7. 不要把技术标内容放入商务标，也不要把商务标内容放入技术标。
8. detail 要简洁明确，说明该标题下应该写什么。
 9. sourceItemIds 必须优先引用输入里给出的 parse item id；直接来自原文的节点用 sourceType="tender"，AI归纳得到的节点用 sourceType="inferred"，仅用于补盲的参考建议节点用 sourceType="reference"。
 10. 如果原文存在“系统技术要求”或同义表达，必须先总结原文中的技术要求要点，再展开三级技术大纲；不得只输出“技术方案”一层。
 11. 只有在原文没有展开技术子项时，才允许参考“访问交互、架构、国产化、安全、备份、高可用、数据质量”等方向作为兜底。
 12. 如果输入中的参考目录建议与原文冲突，以原文为准。`;
    const input = tenderSummary || '请基于当前招标文件原文，生成一份技术标和商务标大纲。';
    const raw = await this.chatJson<unknown>({
      task: 'outlineGenerate',
      systemPrompt: prompt,
      userContent: input,
      temperature: 0.2,
    });

    const normalized = normalizeOutlineGroups(raw);
    if (normalized.length > 0) {
      return normalized;
    }

    return [
      {
        id: 'group-tech',
        group: '技术标',
        sections: [
          {
            id: 'tech-root-1',
            title: '项目理解与需求分析',
            detail: '说明项目背景、建设目标、需求拆解和响应思路。',
            children: [],
          },
          {
            id: 'tech-root-2',
            title: '总体技术方案',
            detail: '说明总体架构、关键能力、技术路线和适配策略。',
            children: [],
          },
        ],
      },
      {
        id: 'group-biz',
        group: '商务标',
        sections: [
          {
            id: 'biz-root-1',
            title: '资格证明文件',
            detail: '营业执照、授权书、资质证书及其他资格类文件。',
            children: [],
          },
          {
            id: 'biz-root-2',
            title: '商务响应与承诺',
            detail: '商务条款响应、交付承诺、售后承诺及偏离说明。',
            children: [],
          },
        ],
      },
    ];
  }

  async generateSectionContent(sectionName: string, context?: string): Promise<string> {
    const systemPrompt = `你是标书撰写专家。根据章节名和上下文，撰写正式、专业的标书正文。可输出简洁 HTML。`;
    const userContent = context
      ? `章节：${sectionName}\n\n参考上下文：\n${context}`
      : `请为“${sectionName}”撰写一段正式标书正文。`;
    const strictSystemPrompt = `你是中国标书撰写专家。你的任务是直接输出可用于标书正文的最终 HTML。

硬性要求：
1. 只输出最终正文，不要输出任务理解、写作计划、提示词复述、用户需求转述或任何“我将/用户需要我/根据以上要求”等元话语。
2. 不要泄露、复述或解释输入中的招标原文、用户 prompt、系统写作策略、评分思路或内部提示词。
3. 如果输入里给了“当前章节原文绑定文本”，它是最高优先级依据；当其他上下文与它冲突时，一律以它为准。
4. 如果输入里给了用户补充要求，只能把它融入正文，不要显式写“用户要求”。
5. 如果输入里给了系统自动生成的写作提示词，只能把它当作写作策略使用，不能原样抄回正文，也不能把它写成任务说明。
6. 输出必须是简洁 HTML，可包含 p、ul、ol、li、strong、table、thead、tbody、tr、td、th、span，不要输出 markdown。
7. 正文要正式、专业、可直接交付；优先使用可验证、可落地、可打分的表达，不要空泛套话。`;
    const strictUserContent = context
      ? `章节：${sectionName}\n\n参考上下文：\n${context}`
      : `请为“${sectionName}”撰写正式标书正文。`;
    return this.chatText({
      task: 'sectionGenerate',
      systemPrompt: strictSystemPrompt,
      userContent: strictUserContent,
      temperature: 0.25,
    });
  }
}
