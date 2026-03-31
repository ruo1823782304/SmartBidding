import { MajorParseCode } from './rag.types';

export interface TenderParseCatalogItem {
  majorCode: MajorParseCode;
  title: string;
  keywords: string[];
  fallbackMinorCode: string;
}

export const TENDER_PARSE_CATALOG: TenderParseCatalogItem[] = [
  {
    majorCode: 'basic_info',
    title: '基础信息',
    keywords: ['项目名称', '项目编号', '招标人', '代理机构', '开标', '预算', '联系人'],
    fallbackMinorCode: 'basic_summary',
  },
  {
    majorCode: 'qualification_requirements',
    title: '资格要求',
    keywords: ['资格', '资质', '业绩', '财务', '信用', '项目经理', '联合体'],
    fallbackMinorCode: 'qualification_summary',
  },
  {
    majorCode: 'review_requirements',
    title: '评审要求',
    keywords: ['评审', '评分', '分值', '技术分', '商务分', '价格分', '评标'],
    fallbackMinorCode: 'review_summary',
  },
  {
    majorCode: 'bid_document_requirements',
    title: '投标文件要求',
    keywords: ['投标文件', '签字', '盖章', '装订', '密封', '副本', '电子版'],
    fallbackMinorCode: 'bid_document_summary',
  },
  {
    majorCode: 'invalid_and_rejection',
    title: '无效标与废标项',
    keywords: ['无效', '废标', '否决', '拒绝', '不予受理'],
    fallbackMinorCode: 'invalid_summary',
  },
  {
    majorCode: 'required_submission_documents',
    title: '应标需提交文件',
    keywords: ['提交', '材料', '授权书', '营业执照', '证明文件', '响应文件'],
    fallbackMinorCode: 'submission_summary',
  },
  {
    majorCode: 'tender_document_review',
    title: '招标文件审查',
    keywords: ['应当', '不得', '未明确', '冲突', '疑义', '不一致', '风险'],
    fallbackMinorCode: 'review_risk_summary',
  },
  {
    majorCode: 'other',
    title: '其他',
    keywords: ['踏勘', '答疑', '保密', '保证金', '服务期', '附录'],
    fallbackMinorCode: 'other_summary',
  },
];
