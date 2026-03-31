# 后端设计文档目录

本目录存放后端分模块设计相关文件，便于按模块实现与定位问题。

| 文件 | 说明 |
|------|------|
| [后端逻辑与模块设计.md](../后端逻辑与模块设计.md) | **主文档**：整体结构、11 个模块职责、接口→模块→文件定位表、各模块目录/逻辑/问题定位、Prisma 模型汇总、Auth 模块代码示例 |
| prisma-schema.example.prisma | Prisma 数据模型示例，按模块分块注释；复制到项目 `prisma/schema.prisma` 后执行 `prisma generate` / `prisma migrate` |

## 模块与路径速查

- **认证** → `src/auth/` — `/api/auth/*`
- **当前用户** → `src/user/` — `/api/user/*`
- **人员配置** → `src/admin/` — `/api/admin/*`
- **项目与看板** → `src/project/` — `/api/projects`（board/创建/状态/归档/大纲）
- **标书解析** → `src/tender/` — `/api/tender/*`
- **标书编制** → `src/proposal/` — `/api/projects/:id/sections/*`、`/proposal/submit`、`/proposal/export`
- **章节分配** → `src/section-assignment/` — `/api/projects/:id/section-assignments`
- **协作任务** → `src/task/` — `/api/projects/:id/tasks`、`/api/tasks/*`、`/api/projects/:id/approvals`
- **企业库** → `src/asset/` — `/api/assets/*`
- **数据中心** → `src/dashboard/` — `/api/dashboard/*`、`/api/knowledge/*`、`/api/rivals/*`、`/api/projects/:id/review`
- **系统设置** → `src/settings/` — `/api/settings/*`

接口与字段以 [接口表与字段说明.md](../接口表与字段说明.md) 为准。
