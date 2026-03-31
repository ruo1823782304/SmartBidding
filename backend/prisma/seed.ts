import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
        selectedModel: 'openai',
        codingPlan: '',
        openaiKey: '',
        qwenKey: '',
        deepseekKey: '',
        baichuanKey: '',
      },
    },
    update: {
      value: {
        selectedModel: 'openai',
        codingPlan: '',
        openaiKey: '',
        qwenKey: '',
        deepseekKey: '',
        baichuanKey: '',
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
