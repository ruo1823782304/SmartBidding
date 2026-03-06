import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { BidLibraryManager, BidLibraryItem } from "./components/BidLibraryManager";
import { TenderAnalyzer, TenderRequirement } from "./components/TenderAnalyzer";
import { ContentMatcher, MatchedContent } from "./components/ContentMatcher";
import { ProposalEditor } from "./components/ProposalEditor";
import { AIAssistant, AIConfig } from "./components/AIAssistant";
import { Button } from "./components/ui/button";
import { FileText, ArrowRight, Database, FileSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { Card } from "./components/ui/card";

function App() {
  const [activeTab, setActiveTab] = useState("library");
  const [bidLibrary, setBidLibrary] = useState<BidLibraryItem[]>([]);
  const [tenderRequirements, setTenderRequirements] = useState<TenderRequirement[]>([]);
  const [matchedContents, setMatchedContents] = useState<MatchedContent[]>([]);
  const [aiConfig, setAIConfig] = useState<AIConfig>({
    model: "gpt-4o",
    enabled: false,
  });

  const handleLibraryUpdate = (items: BidLibraryItem[]) => {
    setBidLibrary(items);
    toast.success(`标书库已更新，当前包含 ${items.length} 个章节`);
  };

  const handleTenderAnalysisComplete = (requirements: TenderRequirement[]) => {
    setTenderRequirements(requirements);
    toast.success(`招标书分析完成，识别出 ${requirements.length} 项要求`);
    setActiveTab("match");
  };

  const handleMatchComplete = (matches: MatchedContent[]) => {
    setMatchedContents(matches);
    const matchedCount = matches.filter(m => m.status === "matched").length;
    toast.success(`内容匹配完成，${matchedCount} 项完全匹配`);
  };

  const handleAIConfigChange = (config: AIConfig) => {
    setAIConfig(config);
    if (config.enabled) {
      toast.success("AI助手已启用");
    } else {
      toast.info("AI助手已禁用");
    }
  };

  const handleGenerateWithAI = async (requirementId: string, context: string): Promise<string> => {
    // 模拟AI生成内容
    // 实际应用中，这里应该调用真实的AI API
    
    if (!aiConfig.enabled || !aiConfig.apiKey) {
      throw new Error("AI助手未配置");
    }

    // 模拟API调用延迟
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 根据requirementId生成不同的模拟内容
    const mockContents: Record<string, string> = {
      "req-9": `项目背景理解

一、监管数据报送现状分析

随着金融监管要求的不断提升，监管机构对金融机构数据报送的及时性、准确性和完整性提出了更高要求。当前贵单位面临以下挑战：

1. 数据来源分散：数据分散在多个业务系统中，缺乏统一的数据采集和管理平台
2. 报送流程复杂：手工操作环节多，效率低下，容易出错
3. 监管要求变化快：监管政策频繁调整，系统需要快速响应
4. 数据质量管控难：缺乏有效的数据校验和质量监控机制

二、项目建设目标理解

本项目旨在构建一套统一的监管数据报送平台，实现：

• 数据自动采集：从各业务系统自动采集数据，减少人工干预
• 智能数据校验：内置监管规则引擎，自动校验数据完整性和准确性
• 一键报送：支持多种监管报表的自动生成和一键报送
• 全程可追溯：完整记录数据处理和报送全过程，支持审计追溯

三、业务价值分析

通过本项目建设，将为贵单位带来：

1. 效率提升：报送效率提升80%以上，降低人力成本
2. 质量保障：数据准确率达到99.9%以上，降低监管风险
3. 快速响应：支持监管政策变化的快速适配
4. 合规保障：确保数据报送符合监管要求，避免处罚风险

我们深刻理解本项目对贵单位监管合规的重要性，将以严谨的态度、专业的能力，高质量完成项目建设。`,

      "req-11": `信创环境适配方案

一、信创环境总体架构

本系统采用全栈信创架构，支持主流国产软硬件环境：

【操作系统层】
• 支持麒麟操作系统（V10、V10 SP1）
• 支持统信UOS操作系统（V20、V20 SP1）
• 支持欧拉openEuler操作系统

【数据库层】
• 主数据库：达梦数据库DM8 / 人大金仓KingbaseES V8
• 缓存数据库：Redis（国产版）
• 支持数据库主备部署、读写分离

【中间件层】
• 应用服务器：东方通TongWeb / 金蝶Apusic
• 消息中间件：普元EOS MQ / 东方通TongLINK/Q

【开发语言与框架】
• 后端：Java（基于OpenJDK）+ Spring Boot
• 前端：Vue.js / React（纯前端框架，无依赖限制）

二、适配验证与优化

1. 兼容性测试
我们已完成主流信创环境的适配测试：
• 麒麟V10 + 达梦DM8：功能完整，性能良好
• 统信UOS + 人大金仓KES：通过全部功能测试
• 已获得相关信创适配认证证书

2. 性能优化
针对国产数据库特点进行专项优化：
• SQL语句优化，适配达梦、金仓数据库语法
• 连接池参数调优，提升并发处理能力
• 索引优化，查询性能提升40%以上

3. 迁移方案
提供完整的数据迁移工具：
• 支持从Oracle、MySQL等数据库平滑迁移
• 数据完整性校验，确保零丢失
• 业务不停机迁移，降低影响

三、技术支撑与服务

• 配备信创技术专家团队，具备丰富的适配经验
• 提供7×24小时技术支持
• 定期进行信创环境巡检和优化
• 跟踪国产软件版本更新，及时适配新版本`,

      "req-14": `信息安全保障方案

一、安全架构设计

采用纵深防御的安全架构，构建多层次安全防护体系：

【网络安全层】
• 部署防火墙、入侵检测系统
• 网络隔离，业务网与监管网物理隔离
• VPN加密通道，保障数据传输安全

【应用安全层】
• 身份认证：支持AD域认证、CA证书认证
• 访问控制：基于RBAC的细粒度权限管理
• 会话管理：会话超时自动登出，防止会话劫持
• 输入验证：防止SQL注入、XSS攻击

【数据安全层】
• 存储加密：敏感数据采用AES-256加密存储
• 传输加密：全程HTTPS/TLS 1.3加密传输
• 数据脱敏：日志、导出数据自动脱敏
• 访问审计：记录所有数据访问操作

二、核心安全功能

1. 统一身份认证
• 集成企业AD域，统一用户管理
• 支持双因素认证（短信、令牌）
• 密码强度策略，定期强制修改

2. 权限管理
• 基于角色的访问控制（RBAC）
• 最小权限原则，按需分配权限
• 权限变更审批流程
• 定期权限审计

3. 安全审计
• 完整的操作日志记录
• 登录日志、数据访问日志、配置变更日志
• 异常行为告警
• 日志防篡改，支持司法取证

4. 数据备份与恢复
• 每日全量备份 + 实时增量备份
• 异地容灾备份
• 备份数据加密存储
• 定期演练恢复流程

三、合规性保障

符合以下安全标准和监管要求：

• 《网络安全法》
• 《数据安全法》
• 《个人信息保护法》
• 《金融行业网络安全等级保护要求》
• 银保监会监管数据安全要求

已通过信息安全等级保护三级认证，具备完善的安全管理体系。

四、应急响应

建立7×24小时安全应急响应机制：

• 安全事件监控：实时监控异常行为
• 快速响应：1小时内响应安全事件
• 事件处置：隔离、分析、处置、恢复
• 事后总结：安全事件报告和改进措施`,
    };

    // 返回对应的模拟内容，如果没有则生成通用内容
    if (mockContents[requirementId]) {
      return mockContents[requirementId];
    }

    // 生成通用AI内容
    return `【AI生成内容】

根据招标要求分析，本部分应包含以下内容：

${context}

详细说明：

1. 理解与分析
我们充分理解本项需求的重要性，将严格按照招标文件要求进行响应。

2. 技术方案
采用业界成熟的技术方案，结合我公司多年项目经验，确保方案的可行性和先进性。

3. 实施保障
配备专业团队，制定详细计划，建立质量保障体系，确保项目成功交付。

4. 服务承诺
提供优质的技术支持和售后服务，保障系统稳定运行。

（注：此内容由AI生成，请根据实际情况进行审核和调整）`;
  };

  const handleProposalExport = () => {
    toast.success("投标书导出完成");
  };

  const canProceedToMatch = bidLibrary.length > 0 && tenderRequirements.length > 0;
  const canProceedToEdit = matchedContents.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <Toaster />

      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">智能标书工具库</h1>
                <p className="text-sm text-muted-foreground">
                  基于标书库检索和AI生成的智能投标系统
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-2 px-3 py-1 bg-muted rounded">
                <Database className="h-4 w-4" />
                <span>标书库: {bidLibrary.length} 项</span>
              </div>
              {aiConfig.enabled && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-950/30 rounded">
                  <Sparkles className="h-4 w-4 text-blue-500" />
                  <span className="text-blue-700 dark:text-blue-300">AI已启用</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="library" className="gap-2">
              <Database className="h-4 w-4" />
              1. 标书库
            </TabsTrigger>
            <TabsTrigger value="tender" className="gap-2">
              <FileSearch className="h-4 w-4" />
              2. 招标分析
            </TabsTrigger>
            <TabsTrigger value="match" disabled={!canProceedToMatch} className="gap-2">
              <FileText className="h-4 w-4" />
              3. 内容匹配
            </TabsTrigger>
            <TabsTrigger value="edit" disabled={!canProceedToEdit} className="gap-2">
              <FileText className="h-4 w-4" />
              4. 编辑生成
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="h-4 w-4" />
              AI助手
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-6">
            <Card className="p-6 bg-blue-50 dark:bg-blue-950/30 border-blue-200">
              <h3 className="font-semibold mb-2">📚 第一步：建立标书库</h3>
              <p className="text-sm text-muted-foreground mb-3">
                上传您的历史投标书文档，系统将按照标准目录结构（第一部分：资信标、第二部分：商务标、第三部分：技术标、第四部分：报价标、第五部分：其他必备文件）自动拆解并保存。这些内容将作为后续生成新投标书的素材库。
              </p>
              {bidLibrary.length > 0 && (
                <Button onClick={() => setActiveTab("tender")} size="sm" className="gap-2">
                  继续下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </Card>

            <BidLibraryManager library={bidLibrary} onLibraryUpdate={handleLibraryUpdate} />
          </TabsContent>

          <TabsContent value="tender" className="space-y-6">
            <Card className="p-6 bg-blue-50 dark:bg-blue-950/30 border-blue-200">
              <h3 className="font-semibold mb-2">🔍 第二步：分析招标书</h3>
              <p className="text-sm text-muted-foreground mb-3">
                上传招标文件，系统将自动分析招标要求，提取关键信息，并按照标书结构生成响应提纲。这个提纲将指导后续的内容匹配和生成工作。
              </p>
              {tenderRequirements.length > 0 && canProceedToMatch && (
                <Button onClick={() => setActiveTab("match")} size="sm" className="gap-2">
                  继续下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </Card>

            <TenderAnalyzer onAnalysisComplete={handleTenderAnalysisComplete} />
          </TabsContent>

          <TabsContent value="match" className="space-y-6">
            <Card className="p-6 bg-blue-50 dark:bg-blue-950/30 border-blue-200">
              <h3 className="font-semibold mb-2">🎯 第三步：智能匹配</h3>
              <p className="text-sm text-muted-foreground mb-3">
                系统正在将招标要求与标书库内容进行智能匹配。完全匹配的内容可直接使用，部分匹配或缺失的内容可通过AI生成或手动补充。
              </p>
              {matchedContents.length > 0 && canProceedToEdit && (
                <Button onClick={() => setActiveTab("edit")} size="sm" className="gap-2">
                  继续编辑
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </Card>

            <ContentMatcher
              requirements={tenderRequirements}
              library={bidLibrary}
              onMatchComplete={handleMatchComplete}
            />
          </TabsContent>

          <TabsContent value="edit" className="space-y-6">
            <Card className="p-6 bg-blue-50 dark:bg-blue-950/30 border-blue-200">
              <h3 className="font-semibold mb-2">✏️ 第四步：编辑与生成</h3>
              <p className="text-sm text-muted-foreground">
                查看和编辑生成的投标书内容。您可以直接使用匹配的内容，也可以点击"AI生成"按钮为缺失的章节生成内容，或手动编辑任何章节。完成后点击"导出投标书"按钮下载完整文档。
              </p>
            </Card>

            <ProposalEditor
              matches={matchedContents}
              requirements={tenderRequirements}
              aiConfig={aiConfig}
              onExport={handleProposalExport}
              onGenerateWithAI={handleGenerateWithAI}
            />
          </TabsContent>

          <TabsContent value="ai" className="space-y-6">
            <Card className="p-6 bg-blue-50 dark:bg-blue-950/30 border-blue-200">
              <h3 className="font-semibold mb-2">🤖 AI助手配置</h3>
              <p className="text-sm text-muted-foreground">
                配置大模型API以启用智能内容生成功能。AI助手可以根据招标要求和标书库上下文，自动生成缺失或低质量的章节内容，提高标书编制��率。
              </p>
            </Card>

            <AIAssistant
              config={aiConfig}
              onConfigChange={handleAIConfigChange}
              onGenerate={handleGenerateWithAI}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 bg-muted/30">
        <div className="container mx-auto px-4 py-6">
          <div className="grid md:grid-cols-3 gap-6 text-sm">
            <div>
              <h4 className="font-semibold mb-2">工作流程</h4>
              <ol className="text-muted-foreground space-y-1 list-decimal list-inside">
                <li>上传历史投标书建立标书库</li>
                <li>上传招标书进行需求分析</li>
                <li>智能匹配标书库内容</li>
                <li>AI生成缺失内容并编辑</li>
                <li>导出完整投标书</li>
              </ol>
            </div>
            <div>
              <h4 className="font-semibold mb-2">核心功能</h4>
              <ul className="text-muted-foreground space-y-1">
                <li>• 标书库管理与内容复用</li>
                <li>• 招标要求智能分析</li>
                <li>• 内容自动匹配与检索</li>
                <li>• AI智能内容生成</li>
                <li>• 在线编辑与导出</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">技术支持</h4>
              <p className="text-muted-foreground">
                支持多种大模型API接入，包括OpenAI、Claude、文心一言、通义千问等。所有数据本地存储，保护您的商业机密。
              </p>
            </div>
          </div>
          <div className="text-center text-muted-foreground mt-6 pt-6 border-t">
            <p>智能标书工具库 - 让投标更高效、更专业</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
