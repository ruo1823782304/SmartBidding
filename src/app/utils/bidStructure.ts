// 标书目录结构定义
export interface BidSection {
  id: string;
  title: string;
  level: number;
  parent?: string;
  children?: BidSection[];
  content?: string;
  required: boolean;
}

// 根据procurement-response-guide.md定义的完整标书结构
export const BID_STRUCTURE: BidSection[] = [
  {
    id: "part1",
    title: "第一部分：资信标（资格审查与资信证明）",
    level: 1,
    required: true,
    children: [
      {
        id: "part1-1",
        title: "响应文件封面与目录",
        level: 2,
        parent: "part1",
        required: true,
        children: [
          { id: "part1-1-1", title: "竞争性磋商采购响应文件封面", level: 3, parent: "part1-1", required: true },
          { id: "part1-1-2", title: "资信标目录", level: 3, parent: "part1-1", required: true },
        ],
      },
      {
        id: "part1-2",
        title: "资格证明文件",
        level: 2,
        parent: "part1",
        required: true,
        children: [
          { id: "part1-2-1", title: "企业法人营业执照（三证合一）", level: 3, parent: "part1-2", required: true },
          { id: "part1-2-2", title: "法定代表人身份证明及身份证复印件", level: 3, parent: "part1-2", required: true },
          { id: "part1-2-3", title: "法定代表人授权委托书及被授权人身份证复印件", level: 3, parent: "part1-2", required: true },
          { id: "part1-2-4", title: "具备履行合同所需设备和专业技术能力的承诺函", level: 3, parent: "part1-2", required: true },
          { id: "part1-2-5", title: "磋商声明书", level: 3, parent: "part1-2", required: true },
        ],
      },
      {
        id: "part1-3",
        title: "资信与业绩证明",
        level: 2,
        parent: "part1",
        required: true,
        children: [
          { id: "part1-3-1", title: "近三年财务状况报告（或财务审计报告）", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-2", title: "依法缴纳税收的证明材料", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-3", title: "依法缴纳社会保障资金的证明材料", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-4", title: "近三年无重大违法记录的声明", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-5", title: "同类项目业绩表", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-6", title: "合同关键页 / 中标通知书 / 验收报告", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-7", title: "企业资质证书", level: 3, parent: "part1-3", required: true },
          { id: "part1-3-8", title: "软件著作权登记证书", level: 3, parent: "part1-3", required: false },
          { id: "part1-3-9", title: "信创适配认证证书", level: 3, parent: "part1-3", required: false },
          { id: "part1-3-10", title: "CMMI、ISO9001/27001/20000、高新技术企业等资质", level: 3, parent: "part1-3", required: false },
        ],
      },
      {
        id: "part1-4",
        title: "其他资信文件",
        level: 2,
        parent: "part1",
        required: false,
        children: [
          { id: "part1-4-1", title: "中小企业声明函", level: 3, parent: "part1-4", required: false },
          { id: "part1-4-2", title: "节能环保产品相关声明", level: 3, parent: "part1-4", required: false },
          { id: "part1-4-3", title: "信用中国 / 中国政府采购网信用查询截图", level: 3, parent: "part1-4", required: true },
        ],
      },
    ],
  },
  {
    id: "part2",
    title: "第二部分：商务标（商务响应与合同条款）",
    level: 1,
    required: true,
    children: [
      {
        id: "part2-1",
        title: "商务标封面与目录",
        level: 2,
        parent: "part2",
        required: true,
        children: [
          { id: "part2-1-1", title: "商务标封面", level: 3, parent: "part2-1", required: true },
          { id: "part2-1-2", title: "商务标目录", level: 3, parent: "part2-1", required: true },
        ],
      },
      {
        id: "part2-2",
        title: "商务响应函",
        level: 2,
        parent: "part2",
        required: true,
        children: [
          { id: "part2-2-1", title: "磋商响应函", level: 3, parent: "part2-2", required: true },
          { id: "part2-2-2", title: "对招标文件的逐条响应", level: 3, parent: "part2-2", required: true },
          { id: "part2-2-3", title: "商务条款响应表", level: 3, parent: "part2-2", required: true },
          { id: "part2-2-4", title: "对付款方式、违约责任等的承诺", level: 3, parent: "part2-2", required: true },
        ],
      },
      {
        id: "part2-3",
        title: "商务承诺",
        level: 2,
        parent: "part2",
        required: true,
        children: [
          { id: "part2-3-1", title: "工期 / 实施周期承诺", level: 3, parent: "part2-3", required: true },
          { id: "part2-3-2", title: "质保期与售后服务期限承诺", level: 3, parent: "part2-3", required: true },
          { id: "part2-3-3", title: "保密承诺书", level: 3, parent: "part2-3", required: true },
          { id: "part2-3-4", title: "知识产权归属承诺", level: 3, parent: "part2-3", required: true },
          { id: "part2-3-5", title: "反商业贿赂承诺书", level: 3, parent: "part2-3", required: true },
          { id: "part2-3-6", title: "供应商廉洁承诺书", level: 3, parent: "part2-3", required: true },
        ],
      },
      {
        id: "part2-4",
        title: "项目团队配置",
        level: 2,
        parent: "part2",
        required: true,
        children: [
          { id: "part2-4-1", title: "项目负责人及其他项目实施人员一览表", level: 3, parent: "part2-4", required: true },
          { id: "part2-4-2", title: "核心人员简历、资质证书、社保缴纳证明", level: 3, parent: "part2-4", required: true },
        ],
      },
    ],
  },
  {
    id: "part3",
    title: "第三部分：技术标（核心实施方案）",
    level: 1,
    required: true,
    children: [
      {
        id: "part3-1",
        title: "技术标封面与目录",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-1-1", title: "技术标封面", level: 3, parent: "part3-1", required: true },
          { id: "part3-1-2", title: "技术标目录", level: 3, parent: "part3-1", required: true },
        ],
      },
      {
        id: "part3-2",
        title: "项目理解与需求分析",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-2-1", title: "对项目背景的理解", level: 3, parent: "part3-2", required: true },
          { id: "part3-2-2", title: "对项目目标的响应", level: 3, parent: "part3-2", required: true },
          { id: "part3-2-3", title: "对核心功能建设的需求拆解", level: 3, parent: "part3-2", required: true },
          { id: "part3-2-4", title: "对技术规范等要求的逐条分析", level: 3, parent: "part3-2", required: true },
        ],
      },
      {
        id: "part3-3",
        title: "总体技术方案",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-3-1", title: "系统总体架构设计", level: 3, parent: "part3-3", required: true },
          { id: "part3-3-2", title: "���创环境适配", level: 3, parent: "part3-3", required: false },
          { id: "part3-3-3", title: "数据采集处理全流程架构", level: 3, parent: "part3-3", required: true },
          { id: "part3-3-4", title: "技术路线选型", level: 3, parent: "part3-3", required: true },
          { id: "part3-3-5", title: "核心功能模块设计", level: 3, parent: "part3-3", required: true },
        ],
      },
      {
        id: "part3-4",
        title: "项目实施计划",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-4-1", title: "实施方法论", level: 3, parent: "part3-4", required: true },
          { id: "part3-4-2", title: "里程碑计划", level: 3, parent: "part3-4", required: true },
          { id: "part3-4-3", title: "甘特图与进度保障措施", level: 3, parent: "part3-4", required: true },
          { id: "part3-4-4", title: "风险识别与应对", level: 3, parent: "part3-4", required: true },
        ],
      },
      {
        id: "part3-5",
        title: "质量与安全保障",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-5-1", title: "质量保障体系", level: 3, parent: "part3-5", required: true },
          { id: "part3-5-2", title: "测试方案", level: 3, parent: "part3-5", required: true },
          { id: "part3-5-3", title: "信息安全方案", level: 3, parent: "part3-5", required: true },
          { id: "part3-5-4", title: "符合监管数据保密与合规要求的措施", level: 3, parent: "part3-5", required: true },
        ],
      },
      {
        id: "part3-6",
        title: "项目实施服务",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-6-1", title: "履行地点与方式", level: 3, parent: "part3-6", required: true },
          { id: "part3-6-2", title: "服务内容", level: 3, parent: "part3-6", required: true },
          { id: "part3-6-3", title: "服务响应标准", level: 3, parent: "part3-6", required: true },
          { id: "part3-6-4", title: "技术服务", level: 3, parent: "part3-6", required: true },
        ],
      },
      {
        id: "part3-7",
        title: "交付与验收",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-7-1", title: "项目交付文档清单", level: 3, parent: "part3-7", required: true },
          { id: "part3-7-2", title: "项目验收方案", level: 3, parent: "part3-7", required: true },
        ],
      },
      {
        id: "part3-8",
        title: "培训方案",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-8-1", title: "最终用户培训", level: 3, parent: "part3-8", required: true },
          { id: "part3-8-2", title: "管理员培训", level: 3, parent: "part3-8", required: true },
          { id: "part3-8-3", title: "培训材料与考核方式", level: 3, parent: "part3-8", required: true },
        ],
      },
      {
        id: "part3-9",
        title: "技术偏离表",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-9-1", title: "技术规范响应表", level: 3, parent: "part3-9", required: true },
          { id: "part3-9-2", title: "服务项目偏离表", level: 3, parent: "part3-9", required: true },
          { id: "part3-9-3", title: "合同条款偏离表", level: 3, parent: "part3-9", required: true },
        ],
      },
      {
        id: "part3-10",
        title: "成功案例",
        level: 2,
        parent: "part3",
        required: true,
        children: [
          { id: "part3-10-1", title: "近三年同类项目案例", level: 3, parent: "part3-10", required: true },
        ],
      },
    ],
  },
  {
    id: "part4",
    title: "第四部分：报价标（价格与商务报价）",
    level: 1,
    required: true,
    children: [
      {
        id: "part4-1",
        title: "报价文件封面",
        level: 2,
        parent: "part4",
        required: true,
      },
      {
        id: "part4-2",
        title: "报价一览表",
        level: 2,
        parent: "part4",
        required: true,
        children: [
          { id: "part4-2-1", title: "项目名称、投标总价、工期、质保期", level: 3, parent: "part4-2", required: true },
        ],
      },
      {
        id: "part4-3",
        title: "报价明细表",
        level: 2,
        parent: "part4",
        required: true,
        children: [
          { id: "part4-3-1", title: "软件开发费用", level: 3, parent: "part4-3", required: true },
          { id: "part4-3-2", title: "实施服务费用", level: 3, parent: "part4-3", required: true },
          { id: "part4-3-3", title: "人力成本", level: 3, parent: "part4-3", required: true },
          { id: "part4-3-4", title: "培训费用", level: 3, parent: "part4-3", required: true },
          { id: "part4-3-5", title: "运维服务费用", level: 3, parent: "part4-3", required: true },
          { id: "part4-3-6", title: "税费、差旅费及其他费用", level: 3, parent: "part4-3", required: true },
        ],
      },
      {
        id: "part4-4",
        title: "可选部件和服务报价表",
        level: 2,
        parent: "part4",
        required: false,
      },
      {
        id: "part4-5",
        title: "报价说明",
        level: 2,
        parent: "part4",
        required: true,
        children: [
          { id: "part4-5-1", title: "报价包含的服务范围", level: 3, parent: "part4-5", required: true },
          { id: "part4-5-2", title: "报价有效期", level: 3, parent: "part4-5", required: true },
          { id: "part4-5-3", title: "优惠承诺与付款方式响应", level: 3, parent: "part4-5", required: true },
        ],
      },
    ],
  },
  {
    id: "part5",
    title: "第五部分：其他必备文件",
    level: 1,
    required: true,
    children: [
      { id: "part5-1", title: "磋商保证金缴纳证明", level: 2, parent: "part5", required: false },
      { id: "part5-2", title: "履约保证金承诺", level: 2, parent: "part5", required: true },
      { id: "part5-3", title: "招标文件要求的其他声明 / 承诺", level: 2, parent: "part5", required: false },
      { id: "part5-4", title: "响应文件自检查表", level: 2, parent: "part5", required: true },
    ],
  },
];

// 将树形结构扁平化，方便检索
export function flattenBidStructure(structure: BidSection[]): BidSection[] {
  const result: BidSection[] = [];
  
  function traverse(sections: BidSection[]) {
    sections.forEach(section => {
      result.push(section);
      if (section.children) {
        traverse(section.children);
      }
    });
  }
  
  traverse(structure);
  return result;
}

// 根据ID查找章节
export function findSectionById(id: string, structure: BidSection[] = BID_STRUCTURE): BidSection | null {
  const flattened = flattenBidStructure(structure);
  return flattened.find(section => section.id === id) || null;
}

// 获取所有必填章节
export function getRequiredSections(structure: BidSection[] = BID_STRUCTURE): BidSection[] {
  const flattened = flattenBidStructure(structure);
  return flattened.filter(section => section.required);
}
