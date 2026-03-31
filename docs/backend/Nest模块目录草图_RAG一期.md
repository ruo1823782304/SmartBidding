# Nest 模块目录草图 RAG 一期

建议目录以当前工程为基础，扩成下面这层：

```text
src/
  app.module.ts
  auth/
  user/
  admin/
  settings/
  project/
  task/
  proposal/
  asset/
  dashboard/
  prisma/
  ai/
  tender/
    dto/
    tender.controller.ts
    tender.service.ts
    workers/
      tender-parse.worker.ts
  document/
    document.module.ts
    document.service.ts
  storage/
    storage.module.ts
    storage.service.ts
  queue/
    queue.module.ts
    queue.service.ts
  rag/
    rag.module.ts
    rag.service.ts
    rag.types.ts
    tender-parse.catalog.ts
    docling-adapter.service.ts
```

模块职责建议：

- `tender`
  - 对外暴露上传、解析、结果查询接口
- `document`
  - 管理 `Document / DocumentVersion / DocumentBlock / DocumentChunk / ParseResult`
- `storage`
  - 封装 MinIO 上传下载
- `queue`
  - 封装 BullMQ 队列与 Redis 连接
- `rag`
  - 封装切块、规则抽取、Docling 适配器、后续 rerank/embedding 接口
- `ai`
  - 封装模型调用、结构化输出和生成留痕

后续二期可以再补：

- `retrieval/`
  - 召回、混合检索、rerank
- `embedding/`
  - 向量生成与重建索引
- `trace/`
  - 原文定位与 PDF 高亮接口
