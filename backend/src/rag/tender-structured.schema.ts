import { MajorParseCode } from './rag.types';

export type TenderFieldType = 'scalar' | 'list-item';

export interface TenderScalarFieldDefinition {
  key: string;
  label: string;
  keywords: string[];
  patterns?: RegExp[];
}

export interface TenderSubTabDefinition {
  key: string;
  label: string;
  keywords: string[];
  mode: 'scalar' | 'list';
  fields?: TenderScalarFieldDefinition[];
}

export interface TenderCategoryDefinition {
  majorCode: MajorParseCode;
  key: string;
  label: string;
  subtabs: TenderSubTabDefinition[];
}

export const TENDER_STRUCTURED_SCHEMA: TenderCategoryDefinition[] = [
  {
    majorCode: 'basic_info',
    key: 'basic',
    label: '基础信息',
    subtabs: [
      {
        key: 'tender',
        label: '招标人/代理信息',
        keywords: ['招标人', '采购人', '代理机构', '联系人', '电话', '邮箱', '网址', '地址'],
        mode: 'scalar',
        fields: [
          { key: 'tender_name', label: '招标人', keywords: ['招标人', '采购人', '采购单位'] },
          { key: 'contact_name', label: '名称', keywords: ['名称', '单位名称'] },
          { key: 'contact_phone', label: '联系电话', keywords: ['联系电话', '电话', '联系方式'], patterns: [/(?:联系电话|电话|联系方式)\s*[：:]\s*([0-9\-()（）]{7,30})/i] },
          { key: 'contact_address', label: '地址', keywords: ['地址', '联系地址', '通讯地址'] },
          { key: 'contact_website', label: '网址', keywords: ['网址', '网站'] },
          { key: 'business_contact', label: '商务联系人', keywords: ['商务联系人'] },
          { key: 'technical_contact', label: '技术联系人', keywords: ['技术联系人'] },
          { key: 'email', label: '电子邮件', keywords: ['电子邮件', '邮箱', 'E-mail'], patterns: [/(?:电子邮件|邮箱|E-?mail)\s*[：:]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i] },
          { key: 'project_contact_name', label: '项目联系人', keywords: ['项目联系人', '联系人'] },
          { key: 'project_contact_phone', label: '项目联系人电话', keywords: ['项目联系电话', '联系人电话', '联系电话'], patterns: [/(?:项目联系电话|联系人电话|联系电话)\s*[：:]\s*([0-9\-()（）]{7,30})/i] },
        ],
      },
      {
        key: 'project',
        label: '项目信息',
        keywords: ['项目编号', '项目名称', '项目概况', '招标范围', '预算', '控制价', '联合体'],
        mode: 'scalar',
        fields: [
          { key: 'project_no', label: '项目编号', keywords: ['项目编号', '招标编号', '采购编号'] },
          { key: 'project_name', label: '项目名称', keywords: ['项目名称', '项目'] },
          { key: 'project_scope', label: '项目概况与招标范围', keywords: ['项目概况', '招标范围', '采购范围', '服务范围'] },
          { key: 'budget', label: '招标控制价', keywords: ['预算金额', '预算', '最高限价', '控制价'] },
          { key: 'joint_bid', label: '是否接受联合体投标', keywords: ['联合体', '联合体投标'] },
        ],
      },
      {
        key: 'time',
        label: '关键时间/内容',
        keywords: ['截止时间', '开标时间', '递交地点', '有效期', '澄清', '公示'],
        mode: 'scalar',
        fields: [
          { key: 'deadline', label: '投标文件递交截止日期', keywords: ['投标截止', '递交截止', '截止时间'] },
          { key: 'delivery_place', label: '投标文件递交地点', keywords: ['递交地点', '送达地点'] },
          { key: 'open_time', label: '开标时间', keywords: ['开标时间'] },
          { key: 'open_place', label: '开标地点', keywords: ['开标地点'] },
          { key: 'clarify_deadline', label: '澄清招标文件截止时间', keywords: ['澄清', '答疑截止'] },
          { key: 'validity', label: '投标有效期', keywords: ['投标有效期', '有效期'] },
          { key: 'public_media', label: '信息公示媒体', keywords: ['公示媒体', '发布媒介', '公告媒介'] },
        ],
      },
      {
        key: 'other',
        label: '其他信息',
        keywords: ['费用', '退还', '偏离', '评标办法', '定标方法', '保证金'],
        mode: 'scalar',
        fields: [
          { key: 'cost_bearing', label: '投标费用承担', keywords: ['投标费用承担', '投标费用'] },
          { key: 'return_file', label: '是否退还投标文件', keywords: ['退还投标文件'] },
          { key: 'deviation', label: '偏离', keywords: ['偏离'] },
          { key: 'review_method', label: '评标办法', keywords: ['评标办法'] },
          { key: 'award_method', label: '定标方法', keywords: ['定标方法'] },
        ],
      },
      {
        key: 'purchase',
        label: '采购要求',
        keywords: [
          '采购要求',
          '采购背景',
          '建设目标',
          '业务要求',
          '功能要求',
          '业务需求',
          '系统功能要求',
          '系统技术要求',
          '技术要求',
          '技术服务要求',
          '服务要求',
          '实施要求',
          '实施计划',
          '项目管理方案',
          '开发方法',
          '测试方法',
          '配置管理方法',
          '技术转移方案',
          '培训方案',
          '运维',
          '保修',
          '访问界面',
          '国产化',
          '安全设计',
          '备份要求',
          '高可用',
          '数据质量',
          '审计',
        ],
        mode: 'list',
      },
    ],
  },
  {
    majorCode: 'qualification_requirements',
    key: 'qualify',
    label: '资格要求',
    subtabs: [
      {
        key: 'qualification',
        label: '资格性和符合性审查',
        keywords: ['资格', '符合性', '营业执照', '资质', '业绩', '财务', '信用', '项目经理'],
        mode: 'list',
      },
    ],
  },
  {
    majorCode: 'review_requirements',
    key: 'review',
    label: '评审要求',
    subtabs: [
      { key: 'score', label: '评分标准', keywords: ['评分标准', '评分', '分值', '打分'], mode: 'list' },
      { key: 'open', label: '开标', keywords: ['开标', '唱标', '开启'], mode: 'list' },
      { key: 'eval', label: '评标', keywords: ['评标', '评审', '评委'], mode: 'list' },
      { key: 'decide', label: '定标', keywords: ['定标', '推荐中标候选人', '候选人'], mode: 'list' },
      { key: 'win', label: '中标要求', keywords: ['中标', '中标通知书', '履约'], mode: 'list' },
    ],
  },
  {
    majorCode: 'bid_document_requirements',
    key: 'bidDoc',
    label: '投标文件要求',
    subtabs: [
      { key: 'compose', label: '投标文件的组成', keywords: ['组成', '商务标', '技术标', '报价'], mode: 'list' },
      { key: 'prep', label: '投标文件的编制', keywords: ['编制', '格式', '签字', '盖章'], mode: 'list' },
      { key: 'seal', label: '投标文件的密封和标记', keywords: ['密封', '标记', '封装'], mode: 'list' },
      { key: 'submit', label: '投标文件的递交', keywords: ['递交', '送达', '提交'], mode: 'list' },
      { key: 'modify', label: '投标文件的修改与撤回', keywords: ['修改', '撤回', '补充'], mode: 'list' },
      { key: 'validity', label: '投标有效期', keywords: ['投标有效期', '有效期'], mode: 'list' },
    ],
  },
  {
    majorCode: 'invalid_and_rejection',
    key: 'invalid',
    label: '无效标与废标项',
    subtabs: [
      { key: 'invalid', label: '废标项', keywords: ['废标', '废标项'], mode: 'list' },
      { key: 'forbid', label: '不得存在的情形', keywords: ['不得存在', '禁止情形', '不得'], mode: 'list' },
      { key: 'reject', label: '否决和无效投标情形', keywords: ['否决', '无效投标', '拒绝'], mode: 'list' },
    ],
  },
  {
    majorCode: 'required_submission_documents',
    key: 'submit',
    label: '应标需提交文件',
    subtabs: [
      { key: 'documents', label: '证明材料', keywords: ['提交材料', '证明文件', '营业执照', '授权书', '简历', '承诺函'], mode: 'list' },
    ],
  },
  {
    majorCode: 'tender_document_review',
    key: 'clause',
    label: '招标文件审查',
    subtabs: [
      { key: 'term', label: '条款风险', keywords: ['条款风险', '冲突', '不明确', '风险'], mode: 'list' },
      { key: 'fair', label: '公平性审查风险', keywords: ['公平性', '限制性', '排他性', '审查'], mode: 'list' },
    ],
  },
];

export function findStructuredCategory(majorCode: MajorParseCode) {
  return TENDER_STRUCTURED_SCHEMA.find((item) => item.majorCode === majorCode);
}
