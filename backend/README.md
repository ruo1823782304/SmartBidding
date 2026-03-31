# 智能标书库 · 后端

NestJS + Prisma + PostgreSQL，实现《接口表与字段说明》全部接口，**不减少前端任何功能**。

## 环境

- Node.js 18+
- PostgreSQL 15+（或 Docker）

## 快速启动

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 数据库

**方式 A：Docker**

```bash
docker-compose up -d
```

**方式 B：本地 PostgreSQL**

创建数据库 `tender_db`，并配置连接串。

### 3. 环境变量

复制并编辑 `.env`：

```bash
cp .env.example .env
# 编辑 .env，设置 DATABASE_URL、JWT_SECRET
# 例如：DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tender_db"
#      JWT_SECRET=your-secret
```

### 4. 迁移与种子

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

### 5. 启动服务

```bash
npm run start:dev
```

接口基址：`http://localhost:3000/api`。默认管理员账号：`admin` / `admin123`。

## 功能概览

| 模块       | 说明 |
|------------|------|
| 认证       | 登录、登出、JWT |
| 用户       | 当前用户、编辑资料 |
| 人员配置   | 用户列表、新增/编辑/重置密码/禁用（仅管理员） |
| 项目与看板 | 看板、创建、状态、归档、大纲 |
| 标书解析   | 上传、解析、解析结果、生成应标大纲（AI） |
| 标书编制   | 章节内容、标记完成、推荐素材、提交审批、导出、**AI 拟写** |
| 章节分配   | 获取/保存章节分配 |
| 协作任务   | 任务列表、分配、审批通过/驳回、审批记录 |
| 企业库     | 资料列表、上传、更新、删除、历史标书归类 |
| 数据中心   | 看板统计、复盘列表/保存、竞争对手 CRUD |
| 设置       | 模型/API Key 配置（仅管理员） |

## 接口与前端对照

详见项目根目录 `docs/backend/前端功能与后端接口对照.md`，确保后端实现与前端一一对应，不减少任何功能。
