# RAG 后端落地方案 V1

## 1. 目标与边界

第一期技术栈采用：

- `NestJS`
- `PostgreSQL`
- `pgvector`
- `Docling`
- `BullMQ`
- `MinIO`

本期目标不是做“通用聊天知识库”，而是做一套适合招投标场景的“结构化解析 + 可追溯 RAG”后端。

核心原则：

- 不要把“8 大点解析”完全交给大模型自由生成。
- 模型必须按固定 `schema` 输出。
- 每条解析结果必须带 `source_paragraph_ids`。
- 不只保存最终答案。
- 必须保存检索命中的 `chunks`、`rerank` 结果、最终引用片段、模型版本和提示词版本。

这套设计优先服务 4 个业务目标：

- 招标文件解析结果可回链原文
- 企业库和历史标书可做可信召回
- 标书编制时可按章节拿到可引用素材
- 审批、复核、问题追踪时能追溯“答案从哪里来”

## 2. 模块落位

结合当前后端目录，建议这样扩展：

- `src/tender`
  - 负责招标文件上传、解析任务创建、解析结果查询、8 大点输出
- `src/asset`
  - 负责企业库文档上传、切块、索引、检索
- `src/proposal`
  - 负责标书章节引用推荐、生成引用记录、保存采用片段
- `src/ai`
  - 负责模型调用、结构化输出校验、rerank、生成日志
- `src/task`
  - 负责解析任务、重试、失败告警、审批留痕联动
- `src/project`
  - 负责项目级上下文、当前招标文件版本、当前解析版本绑定
- 新增 `src/rag`
  - 负责统一的 chunk 检索、混合检索、引用构建、trace 组装
- 新增 `src/queue`
  - 负责 BullMQ 队列、worker、任务事件
- 新增 `src/storage`
  - 负责 MinIO 文件上传下载、版本化对象路径

## 3. 总体流程

### 3.1 招标文件解析流程

1. 前端上传招标文件
2. 后端写入 `MinIO`
3. 创建 `document` 记录与 `document_version`
4. 创建 `parse_job`
5. BullMQ worker 拉起解析任务
6. Docling 抽取页面、段落、表格、标题层级、坐标
7. 写入 `document_block`
8. 按结构规则切块，写入 `document_chunk`
9. 生成 embedding，写入 `document_chunk.embedding`
10. 执行 8 大点结构化抽取
11. 每条结果写入 `parse_result_item`
12. 保存本次 LLM 调用、检索命中、rerank、引用片段
13. 更新 `parse_job` 为完成

### 3.2 标书编制检索流程

1. 用户进入某个章节
2. 系统拿到 `project_id + section_key + query_intent`
3. 在招标文件索引、企业库索引、历史标书索引内做路由检索
4. 执行混合召回
5. 执行 rerank
6. 组装引用片段
7. 返回“推荐素材 + 引用来源 + 可回链原文定位”

## 4. 数据表设计

下面是建议新增或升级的核心表。命名上尽量贴近 Prisma 现有风格。

### 4.1 文档主表

#### `Document`

用于统一管理招标文件、企业库文件、历史标书、导出件。

关键字段：

- `id`
- `projectId` 可空
- `assetId` 可空
- `documentType`
  - `TENDER`
  - `ASSET`
  - `HISTORY_PROPOSAL`
  - `EXPORT`
- `bizCategory`
  - `TENDER_SOURCE`
  - `COMPANY_PROFILE`
  - `CASE_STUDY`
  - `QUALIFICATION`
  - `FINANCIAL`
  - `CONTRACT`
  - `OTHER`
- `title`
- `mimeType`
- `fileExt`
- `currentVersionId`
- `status`
  - `UPLOADED`
  - `PARSING`
  - `READY`
  - `FAILED`
- `createdBy`
- `createdAt`
- `updatedAt`

建议索引：

- `@@index([projectId, documentType])`
- `@@index([assetId])`
- `@@index([status])`

#### `DocumentVersion`

用于同一文档的多次上传与版本追踪。

关键字段：

- `id`
- `documentId`
- `versionNo`
- `storageBucket`
- `storageKey`
- `fileName`
- `fileSize`
- `contentHash`
- `parseStatus`
- `createdBy`
- `createdAt`

建议索引：

- `@@unique([documentId, versionNo])`
- `@@index([documentId, parseStatus])`
- `@@index([contentHash])`

### 4.2 原文结构表

#### `DocumentPage`

关键字段：

- `id`
- `documentVersionId`
- `pageNo`
- `width`
- `height`
- `rotation`
- `imageKey` 可空

建议索引：

- `@@unique([documentVersionId, pageNo])`

#### `DocumentBlock`

这是最关键的“原文定位层”，一条记录代表一个可定位原文块，通常是段落、标题、表格单元或列表项。

关键字段：

- `id`
- `documentVersionId`
- `pageId`
- `blockType`
  - `TITLE`
  - `HEADING`
  - `PARAGRAPH`
  - `LIST_ITEM`
  - `TABLE`
  - `TABLE_ROW`
  - `TABLE_CELL`
- `sectionPath`
  - 例：`第一章 投标邀请书 > 3.投标人资格要求`
- `headingLevel`
- `paragraphNo`
- `text`
- `textHash`
- `tokens`
- `bbox`
  - 页面坐标，JSON
- `charStart`
- `charEnd`
- `metadata`
  - OCR 置信度、表格坐标、解析来源等

建议索引：

- `@@index([documentVersionId, pageId])`
- `@@index([documentVersionId, blockType])`
- `@@index([documentVersionId, paragraphNo])`
- `@@index([documentVersionId, textHash])`

### 4.3 切块与向量表

#### `DocumentChunk`

`chunk` 不是简单按 token 均分，而是从 `DocumentBlock` 结构聚合出来的检索单元。

关键字段：

- `id`
- `documentVersionId`
- `documentId`
- `chunkType`
  - `SECTION_SUMMARY`
  - `PARAGRAPH_WINDOW`
  - `TABLE_REQUIREMENT`
  - `QUALIFICATION_CLAUSE`
  - `REVIEW_RULE`
  - `SUBMISSION_LIST`
- `sourceBlockIds`
  - JSON 数组
- `sectionPath`
- `pageStart`
- `pageEnd`
- `text`
- `textForEmbedding`
- `keywords`
- `tsv`
  - PostgreSQL 全文检索字段
- `embedding`
  - `vector(1024)` 或按模型维度配置
- `importanceScore`
- `documentType`
- `bizCategory`
- `versionNo`
- `createdAt`

建议索引：

- `@@index([documentVersionId, sectionPath])`
- `@@index([documentType, bizCategory])`
- `@@index([documentId, versionNo])`
- `GIN (tsv)`
- `HNSW (embedding vector_cosine_ops)`

建议 SQL：

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX idx_document_chunk_tsv
ON "DocumentChunk"
USING GIN ("tsv");

CREATE INDEX idx_document_chunk_embedding_hnsw
ON "DocumentChunk"
USING hnsw ("embedding" vector_cosine_ops);
```

### 4.4 解析结果表

#### `ParseJob`

替代当前较轻量的 `TenderParseTask`，或在其基础上扩展。

关键字段：

- `id`
- `projectId`
- `documentId`
- `documentVersionId`
- `jobType`
  - `TENDER_PARSE`
  - `ASSET_PARSE`
  - `REINDEX`
- `status`
  - `PENDING`
  - `RUNNING`
  - `SUCCEEDED`
  - `FAILED`
- `progress`
- `currentStage`
  - `UPLOAD`
  - `DOCLING`
  - `BLOCK_EXTRACT`
  - `CHUNK_INDEX`
  - `LLM_EXTRACT`
  - `FINALIZE`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `createdAt`

建议索引：

- `@@index([projectId, createdAt])`
- `@@index([documentVersionId, status])`

#### `ParseResult`

一条记录代表某次“8 大点结构化解析”的总结果。

关键字段：

- `id`
- `parseJobId`
- `projectId`
- `documentId`
- `documentVersionId`
- `schemaVersion`
- `promptVersion`
- `modelProvider`
- `modelName`
- `status`
- `summary`
- `createdAt`

建议索引：

- `@@index([projectId, createdAt])`
- `@@index([documentVersionId, schemaVersion])`

#### `ParseResultItem`

一条记录代表 8 大点下的一个具体小点结果。

关键字段：

- `id`
- `parseResultId`
- `majorCode`
  - `basic_info`
  - `qualification_requirements`
  - `review_requirements`
  - `bid_document_requirements`
  - `invalid_and_rejection`
  - `required_submission_documents`
  - `tender_document_review`
  - `other`
- `minorCode`
  - 例如 `bidder_contact`, `performance_requirement`, `scoring_price_rule`
- `title`
- `content`
- `normalizedValue`
  - 用于结构化字段，如日期、金额、数量、布尔值
- `confidence`
- `priority`
- `isRequired`
- `riskLevel`
- `sourceParagraphIds`
  - JSON 数组
- `sourceChunkIds`
  - JSON 数组
- `sourceQuote`
- `reviewStatus`
  - `AUTO`
  - `CONFIRMED`
  - `CORRECTED`
- `createdAt`
- `updatedAt`

建议索引：

- `@@index([parseResultId, majorCode])`
- `@@index([parseResultId, majorCode, minorCode])`
- `@@index([riskLevel])`

### 4.5 检索与生成留痕表

#### `RetrievalLog`

保存每一次检索请求，不论是解析阶段还是编制阶段。

关键字段：

- `id`
- `projectId`
- `scene`
  - `PARSE`
  - `PROPOSAL_ASSIST`
  - `ASSET_SEARCH`
- `queryText`
- `queryIntent`
- `filters`
- `topK`
- `retrievalStrategy`
  - `BM25`
  - `VECTOR`
  - `HYBRID`
- `createdBy`
- `createdAt`

#### `RetrievalLogHit`

保存召回命中结果。

关键字段：

- `id`
- `retrievalLogId`
- `chunkId`
- `source`
  - `TENDER`
  - `ASSET`
  - `HISTORY`
- `bm25Score`
- `vectorScore`
- `hybridScore`
- `rankBeforeRerank`
- `rankAfterRerank`
- `isSelected`

建议索引：

- `@@index([retrievalLogId, rankAfterRerank])`

#### `GenerationLog`

保存模型调用输入输出和版本信息。

关键字段：

- `id`
- `projectId`
- `scene`
  - `TENDER_PARSE`
  - `SECTION_DRAFT`
  - `SECTION_REWRITE`
  - `QA`
- `provider`
- `modelName`
- `modelVersion`
- `temperature`
- `promptVersion`
- `systemPrompt`
- `userPrompt`
- `responseText`
- `responseJson`
- `status`
- `errorMessage`
- `latencyMs`
- `tokenUsage`
- `createdAt`

#### `GenerationCitation`

保存最终被模型引用采用的内容。

关键字段：

- `id`
- `generationLogId`
- `chunkId`
- `blockIds`
- `quote`
- `citationOrder`

### 4.6 编制落地表

#### `SectionEvidence`

保存某一章节最终采用了哪些证据片段，便于审批和复核。

关键字段：

- `id`
- `projectId`
- `sectionKey`
- `sectionContentId`
- `sourceType`
  - `TENDER`
  - `ASSET`
  - `HISTORY`
- `documentId`
- `documentVersionId`
- `chunkId`
- `blockIds`
- `quote`
- `usedFor`
  - `DIRECT_QUOTE`
  - `FACT_REFERENCE`
  - `DRAFT_SUPPORT`
- `createdBy`
- `createdAt`

建议索引：

- `@@index([projectId, sectionKey])`
- `@@index([sectionContentId])`

## 5. 索引设计

### 5.1 检索层

招投标场景必须使用混合检索，不建议只做向量检索。

推荐策略：

- PostgreSQL 全文检索：召回精确术语
- `pgvector`：召回语义相近条款
- rerank：重排最终上下文

检索流程：

1. 先按文档类型过滤
2. 跑 `tsvector` 检索
3. 跑 `embedding` 检索
4. 按加权分融合
5. 再做 rerank

加权建议：

- 精确字段查询：`BM25 0.7 + Vector 0.3`
- 模糊问答查询：`BM25 0.4 + Vector 0.6`
- 编制推荐：`BM25 0.3 + Vector 0.5 + MetadataBoost 0.2`

### 5.2 业务过滤条件

所有检索接口建议支持以下过滤：

- `documentType`
- `bizCategory`
- `projectId`
- `sectionPath`
- `majorCode`
- `minorCode`
- `pageRange`
- `versionNo`
- `tags`

## 6. 文档切块策略

### 6.1 切块原则

不要按固定 `500 tokens` 粗切。招标文件更适合“结构优先”切块。

建议切块顺序：

1. 先按文档结构抽 `heading`
2. 再按段落、列表、表格拆 `block`
3. 再按业务语义合成 `chunk`

### 6.2 推荐切块类型

#### A. 段落窗口块

适合普通问答与来源定位。

规则：

- 核心段落 + 前后各 1 段
- 单块控制在 `300-800` 汉字
- 保留 `sectionPath + pageRange + sourceBlockIds`

#### B. 条款块

适合资格要求、废标项、提交材料。

规则：

- 以列表项或条款号为边界
- 尽量一条要求一个块
- 如果条款跨段，允许聚合多个 `block`

#### C. 表格块

适合评分表、提交材料清单、资格审查表。

规则：

- 保留行列坐标
- 一行规则一个块
- 同时保留原始表格 JSON

#### D. 章节摘要块

适合快速路由和粗召回。

规则：

- 每个二级标题生成一个摘要块
- 摘要块不用于最终引用
- 只用于预筛选

### 6.3 切块元数据

每个 `chunk` 至少保存：

- `sourceBlockIds`
- `sectionPath`
- `pageStart/pageEnd`
- `documentType`
- `bizCategory`
- `keywords`
- `versionNo`
- `importanceScore`

## 7. 8 大点解析 schema

解析结果必须走固定 schema。推荐一条大结果 + 多条明细项的结构。

### 7.1 顶层 schema

```json
{
  "schema_version": "tender-parse-v1",
  "document_id": "doc_xxx",
  "document_version_id": "ver_xxx",
  "major_items": [
    {
      "major_code": "basic_info",
      "major_name": "基础信息",
      "items": []
    }
  ]
}
```

### 7.2 每条小点 schema

```json
{
  "minor_code": "project_name",
  "title": "项目名称",
  "content": "智慧园区建设项目",
  "normalized_value": {
    "text": "智慧园区建设项目"
  },
  "confidence": 0.96,
  "priority": "high",
  "is_required": true,
  "risk_level": "low",
  "source_paragraph_ids": ["blk_101", "blk_102"],
  "source_chunk_ids": ["chk_32"],
  "source_quote": "项目名称：智慧园区建设项目",
  "extraction_note": "由招标公告首页基础信息提取"
}
```

### 7.3 8 大点建议明细

#### `basic_info` 基础信息

建议小点：

- `bidder_name`
- `agency_name`
- `project_name`
- `project_no`
- `budget_amount`
- `max_price`
- `bid_section`
- `bid_open_time`
- `bid_open_location`
- `contact_person`
- `contact_phone`

#### `qualification_requirements` 资格要求

建议小点：

- `subject_qualification`
- `business_license`
- `safety_permit`
- `performance_requirement`
- `financial_requirement`
- `credit_requirement`
- `team_requirement`
- `project_manager_requirement`
- `consortium_requirement`
- `other_qualification_requirement`

#### `review_requirements` 评审要求

建议小点：

- `review_method`
- `price_score_rule`
- `business_score_rule`
- `technical_score_rule`
- `objective_score_items`
- `subjective_score_items`
- `weight_distribution`
- `winning_recommendation_rule`

#### `bid_document_requirements` 投标文件要求

建议小点：

- `format_requirement`
- `binding_requirement`
- `signature_requirement`
- `seal_requirement`
- `copy_count_requirement`
- `electronic_submission_requirement`
- `catalog_requirement`
- `template_requirement`

#### `invalid_and_rejection` 无效标与废标项

建议小点：

- `invalid_bid_clause`
- `rejection_clause`
- `missing_material_clause`
- `late_submission_clause`
- `price_abnormal_clause`
- `consistency_clause`

#### `required_submission_documents` 应标需提交文件

建议小点：

- `legal_representative_doc`
- `authorization_letter`
- `business_license_copy`
- `qualification_certificate_copy`
- `performance_proof`
- `financial_statement`
- `tax_social_security_proof`
- `technical_response_doc`
- `commercial_response_doc`
- `quotation_sheet`
- `other_required_file`

#### `tender_document_review` 招标文件审查

这个大点不是照抄原文，而是系统做“审查提示”。

建议小点：

- `ambiguity_clause`
- `conflicting_deadline`
- `missing_scoring_detail`
- `unclear_submission_requirement`
- `suspected_unreasonable_clause`
- `high_risk_clause`

注意：

- 这类结果应标记 `reviewStatus = AUTO`
- 必须附上触发依据的 `source_paragraph_ids`
- 最好有人审后再确认

#### `other` 其他

建议小点：

- `confidentiality_requirement`
- `onsite_survey_requirement`
- `qa_deadline`
- `deposit_requirement`
- `service_period_requirement`
- `special_appendix_requirement`

## 8. 每条结果如何回链原文

### 8.1 回链所需最小信息

每条解析结果必须至少保留：

- `documentVersionId`
- `sourceParagraphIds`
- `sourceChunkIds`
- `sourceQuote`
- `sectionPath`
- `pageNo`
- `bbox`

### 8.2 回链链路

后端返回结果时，建议直接组装 `trace`：

```json
{
  "trace": [
    {
      "document_version_id": "ver_xxx",
      "page_no": 12,
      "section_path": "第四章 评标办法 > 2.资格审查",
      "block_id": "blk_390",
      "bbox": [82, 216, 980, 290],
      "quote": "投标人须具有建筑工程施工总承包贰级及以上资质。"
    }
  ]
}
```

### 8.3 前端使用方式

前端拿到 `trace` 后可以做：

1. 点击解析小点
2. 请求 `/api/tender/trace/:itemId`
3. 返回 `pageNo + bbox + quote + sectionPath`
4. PDF 预览区跳到对应页
5. 高亮对应段落或框选区域

### 8.4 为什么必须存 `block` 而不是只存 quote

只存 `quote` 会有 3 个问题：

- 同一句话可能在多处重复
- OCR 或格式变化会导致定位失败
- 后续重新分页时难以稳定回链

所以应优先用 `block_id` 回链，`quote` 只作为展示辅助。

## 9. 模型约束与结构化输出

### 9.1 模型职责边界

模型只做这些事：

- 在候选 chunk 中抽取目标字段
- 依据固定 schema 输出 JSON
- 给出字段级证据映射
- 给出置信度与风险提示

模型不要直接做这些事：

- 自由发挥总结整份招标文件
- 没有证据时自行脑补
- 输出无法定位来源的结论

### 9.2 结构化输出校验

建议在 `src/ai` 中增加：

- `schema validator`
- `enum validator`
- `source_paragraph_ids validator`
- `post processor`

校验失败时：

1. 标记当前 `generation_log` 为失败
2. 进入重试或人工复核队列
3. 不直接覆盖正式解析结果

## 10. 检索、rerank、引用必须留痕

这部分是后期复核价值最高的设计，必须保留。

每次生成或解析至少保存：

- 原始 query
- 使用的 filters
- topK 召回结果
- rerank 前排序
- rerank 后排序
- 最终选中的 chunk
- 最终引用的 block
- 使用的模型、版本、prompt 版本
- 输出 JSON
- 错误信息

这样后面才能处理：

- 为什么这条资格要求识别错了
- 为什么生成结果引用了错误材料
- 为什么驳回时找不到原始依据
- 为什么新模型上线后结果变差

## 11. 和现有 Prisma / 模块的衔接建议

### 11.1 建议保留并扩展

- `TenderFile`
  - 可以逐步过渡到 `Document / DocumentVersion`
- `TenderParseTask`
  - 可以升级为 `ParseJob`
- `Asset`
  - 继续保留，作为企业库业务表
- `SectionContent`
  - 新增和 `SectionEvidence` 的关联

### 11.2 建议新增模块

- `rag.module.ts`
- `queue.module.ts`
- `storage.module.ts`
- `document.module.ts`

### 11.3 TenderService 第一阶段改造方向

当前 `TenderService` 还是“上传后本地写文件 + setImmediate + mock result”。

建议第一阶段改成：

1. 上传文件到 MinIO
2. 写 `Document` 和 `DocumentVersion`
3. 创建 `ParseJob`
4. 投递 BullMQ 队列
5. 由 worker 调 Docling
6. 落库 `DocumentBlock / DocumentChunk / ParseResult / ParseResultItem`

## 12. 第一期实施顺序

建议按下面顺序做，风险最低。

### P1. 文档解析底座

- 接 MinIO
- 新增 `Document / DocumentVersion / DocumentBlock`
- 接 Docling
- 能把 PDF/DOCX 解析成段落和页码

### P2. 检索底座

- 新增 `DocumentChunk`
- 接 `pgvector`
- 建立全文检索和向量检索
- 提供 `/search` 内部服务

### P3. 8 大点结构化解析

- 新增 `ParseJob / ParseResult / ParseResultItem`
- 固定 schema 抽取
- 每条结果强制带 `source_paragraph_ids`

### P4. 留痕与回链

- 新增 `RetrievalLog / RetrievalLogHit / GenerationLog / GenerationCitation`
- 提供 trace 查询接口

### P5. 编制联动

- 新增 `SectionEvidence`
- 在标书编制页展示“本段依据来源”

## 13. 接口草案

建议新增或重构接口：

- `POST /api/tender/upload`
- `POST /api/tender/parse`
- `GET /api/tender/parse/jobs/:jobId`
- `GET /api/tender/parse/results/:parseResultId`
- `GET /api/tender/parse/items/:itemId/trace`
- `POST /api/rag/search`
- `POST /api/rag/recommend`
- `POST /api/proposal/sections/:sectionKey/evidence`
- `GET /api/proposal/sections/:sectionKey/evidence`

## 14. 一句话原则

这套系统的关键不是“模型多聪明”，而是：

- 结构化抽得准
- 来源回得去
- 检索过程可追溯
- 生成结果可复核

后续如果进入实现阶段，开发时要一直守住这 4 条。
