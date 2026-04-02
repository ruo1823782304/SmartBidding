import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const defaultProviders = [
  {
    id: 'openai-default',
    label: 'OpenAI',
    vendor: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o',
    wireApi: 'openai-chat',
    enabled: true,
  },
  {
    id: 'claude-default',
    label: 'Claude',
    vendor: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
    wireApi: 'anthropic-messages',
    enabled: true,
  },
  {
    id: 'deepseek-default',
    label: 'DeepSeek',
    vendor: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    wireApi: 'openai-chat',
    enabled: true,
  },
  {
    id: 'doubao-default',
    label: '豆包',
    vendor: 'doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    model: 'doubao-seed-1-6-250615',
    wireApi: 'openai-chat',
    enabled: true,
  },
  {
    id: 'qwen-default',
    label: '通义千问',
    vendor: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    model: 'qwen-plus',
    wireApi: 'openai-chat',
    enabled: true,
  },
  {
    id: 'minimax-default',
    label: 'MiniMax',
    vendor: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKey: '',
    model: 'MiniMax-M2.5',
    wireApi: 'openai-chat',
    enabled: true,
  },
  {
    id: 'kimi-default',
    label: 'Kimi',
    vendor: 'kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    model: 'kimi-k2.5',
    wireApi: 'openai-chat',
    enabled: true,
  },
  {
    id: 'zhipu-default',
    label: '智谱',
    vendor: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    model: 'glm-4-air',
    wireApi: 'openai-chat',
    enabled: true,
  },
];

async function main() {
  const hashed = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { username: 'admin' },
    create: {
      username: 'admin',
      password: hashed,
      name: '管理员',
      role: '管理员',
      status: 'enabled',
    },
    update: {
      password: hashed,
      name: '管理员',
      role: '管理员',
      status: 'enabled',
    },
  });

  await prisma.systemConfig.upsert({
    where: { key: 'model_config' },
    create: {
      key: 'model_config',
      value: {
        codingPlan: '',
        codingPlanUrl: '',
        codingPlanApiKey: '',
        codingPlanAppId: '',
        supportedModels: [],
        activeProviderId: 'openai-default',
        providers: defaultProviders,
        taskRouting: {
          defaultProviderId: 'openai-default',
          tenderParseProviderId: 'openai-default',
          outlineGenerateProviderId: 'openai-default',
          sectionGenerateProviderId: 'openai-default',
        },
      },
    },
    update: {
      value: {
        codingPlan: '',
        codingPlanUrl: '',
        codingPlanApiKey: '',
        codingPlanAppId: '',
        supportedModels: [],
        activeProviderId: 'openai-default',
        providers: defaultProviders,
        taskRouting: {
          defaultProviderId: 'openai-default',
          tenderParseProviderId: 'openai-default',
          outlineGenerateProviderId: 'openai-default',
          sectionGenerateProviderId: 'openai-default',
        },
      },
    },
  });

  console.log('Seed done: admin/admin123, model_config default.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
