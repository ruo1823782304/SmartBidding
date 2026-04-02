import type {
  TenderParsedCategory,
  TenderParsedGroup,
  TenderParsedItem,
  TenderSourceTrace,
} from "../types/tender";

export type TenderTraceValue = {
  text: string;
  trace: TenderSourceTrace | null;
};

export type TenderTraceField = {
  label: string;
  value: TenderTraceValue;
};

export type TenderBasicSubTab = "tender" | "project" | "time" | "other" | "purchase";

export type TenderBasicInfoView = {
  tenderName: TenderTraceValue;
  tenderContacts: TenderTraceField[];
  projectContacts: { name: TenderTraceValue; phone: TenderTraceValue }[];
  projectFields: TenderTraceField[];
  timeFields: TenderTraceField[];
  otherFields: TenderTraceField[];
  purchaseGroups: TenderParsedGroup[];
};

export type TenderSubTabDefinition = {
  key: string;
  label: string;
  keywords: string[];
};

const EMPTY_TRACE_VALUE: TenderTraceValue = {
  text: "—",
  trace: null,
};

const BASIC_SUB_TAB_KEYWORDS: Record<TenderBasicSubTab, string[]> = {
  tender: ["招标人", "采购人", "代理", "联系人", "联系方式", "邮箱", "网址", "地址"],
  project: ["项目", "标段", "项目编号", "项目名称", "联合体", "预算", "控制价", "概况", "范围"],
  time: ["时间", "截止", "开标", "递交", "地点", "有效期", "澄清", "公示", "日期"],
  other: ["费用", "退还", "偏离", "评标办法", "定标", "保证金", "答疑", "踏勘", "保密"],
  purchase: ["采购", "需求", "服务", "功能", "技术", "建设", "内容", "范围"],
};

function normalizeText(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildSearchText(item: TenderParsedItem) {
  return normalizeText(
    [item.title, item.content, item.trace.outline, item.trace.quote, item.trace.paragraph].join(" "),
  );
}

function sanitizeExtractedValue(value?: string) {
  const sanitized = (value ?? "")
    .replace(/^[：:\s]+/, "")
    .replace(/[；;。,\s]+$/, "")
    .trim();
  return sanitized || "—";
}

function extractWithPatterns(
  items: TenderParsedItem[],
  options: {
    titleKeywords?: string[];
    regexes?: RegExp[];
  },
): TenderTraceValue {
  const { titleKeywords = [], regexes = [] } = options;

  for (const item of items) {
    const title = normalizeText(item.title);
    if (titleKeywords.some((keyword) => title.includes(keyword))) {
      return {
        text: sanitizeExtractedValue(item.content || item.trace.quote || item.trace.paragraph),
        trace: item.trace,
      };
    }
  }

  for (const item of items) {
    const candidates = [
      normalizeText(item.trace.paragraph),
      normalizeText(item.trace.quote),
      normalizeText(item.content),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const regex of regexes) {
        const matched = candidate.match(regex);
        const value = sanitizeExtractedValue(matched?.[1]);
        if (matched?.[1] && value !== "—") {
          return {
            text: value,
            trace: item.trace,
          };
        }
      }
    }
  }

  return EMPTY_TRACE_VALUE;
}

function scoreTextByKeywords(text: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
}

function flattenCategoryItems(category?: TenderParsedCategory | null) {
  if (!category) return [] as TenderParsedItem[];
  return category.groups.flatMap((group) => group.items);
}

export function findTenderCategory(
  categories: TenderParsedCategory[],
  key: string,
) {
  return categories.find((category) => category.key === key);
}

export function pickCategoryGroups(
  category: TenderParsedCategory | undefined,
  definitions: TenderSubTabDefinition[],
) {
  if (!category) {
    return definitions.reduce<Record<string, TenderParsedGroup[]>>((acc, definition) => {
      acc[definition.key] = [];
      return acc;
    }, {});
  }

  const usedGroupKeys = new Set<string>();
  const mapping = definitions.reduce<Record<string, TenderParsedGroup[]>>((acc, definition) => {
    const matched = category.groups
      .map((group) => ({
        group,
        score: scoreTextByKeywords(
          normalizeText(
            [
              group.label,
              ...group.items.map((item) => [item.title, item.content, item.trace.outline].join(" ")),
            ].join(" "),
          ),
          definition.keywords,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.group);

    const uniqueMatched = matched.filter((group) => !usedGroupKeys.has(group.key));
    uniqueMatched.forEach((group) => usedGroupKeys.add(group.key));
    acc[definition.key] = uniqueMatched;
    return acc;
  }, {});

  const remaining = category.groups.filter((group) => !usedGroupKeys.has(group.key));
  const firstEmptyDefinition = definitions.find((definition) => mapping[definition.key].length === 0);
  if (firstEmptyDefinition && remaining.length > 0) {
    mapping[firstEmptyDefinition.key] = remaining;
  }

  return mapping;
}

function pickBasicItems(category: TenderParsedCategory | undefined, subTab: TenderBasicSubTab) {
  const allItems = flattenCategoryItems(category);
  const keywords = BASIC_SUB_TAB_KEYWORDS[subTab];

  const matched = allItems.filter((item) => scoreTextByKeywords(buildSearchText(item), keywords) > 0);
  return matched.length > 0 ? matched : allItems;
}

export function pickDefaultTrace(categories: TenderParsedCategory[]) {
  for (const category of categories) {
    for (const group of category.groups) {
      const firstItem = group.items[0];
      if (firstItem?.trace) {
        return firstItem.trace;
      }
    }
  }
  return null;
}

export function buildBasicInfoView(category?: TenderParsedCategory): TenderBasicInfoView {
  const tenderItems = pickBasicItems(category, "tender");
  const projectItems = pickBasicItems(category, "project");
  const timeItems = pickBasicItems(category, "time");
  const otherItems = pickBasicItems(category, "other");
  const purchaseGroups = pickCategoryGroups(
    category,
    [
      {
        key: "purchase",
        label: "采购要求",
        keywords: BASIC_SUB_TAB_KEYWORDS.purchase,
      },
    ],
  ).purchase;

  const tenderName = extractWithPatterns(tenderItems, {
    titleKeywords: ["招标人", "采购人", "采购单位", "招标代理机构", "代理机构"],
    regexes: [
      /(?:招标人|采购人|采购单位|招标代理机构|代理机构)\s*[：:]\s*([^\n；;，,]+)/i,
      /(?:名称|单位名称)\s*[：:]\s*([^\n；;，,]+)/i,
    ],
  });

  const tenderContacts: TenderTraceField[] = [
    {
      label: "名称",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["招标人", "采购人", "名称", "单位名称"],
        regexes: [
          /(?:招标人|采购人|采购单位|单位名称|名称)\s*[：:]\s*([^\n；;，,]+)/i,
        ],
      }),
    },
    {
      label: "联系电话",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["联系电话", "电话", "联系方式"],
        regexes: [
          /(?:联系电话|电话|联系方式)\s*[：:]\s*([0-9\-()（）]{7,30})/i,
        ],
      }),
    },
    {
      label: "地址",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["地址", "联系地址", "通讯地址"],
        regexes: [
          /(?:联系地址|通讯地址|地址)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "网址",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["网址", "网站"],
        regexes: [
          /(?:网址|网站)\s*[：:]\s*((?:https?:\/\/|www\.)?[^\s；;]+)/i,
        ],
      }),
    },
    {
      label: "商务联系人",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["商务联系人"],
        regexes: [
          /(?:商务联系人)\s*[：:]\s*([^\n；;，,]+)/i,
        ],
      }),
    },
    {
      label: "技术联系人",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["技术联系人"],
        regexes: [
          /(?:技术联系人)\s*[：:]\s*([^\n；;，,]+)/i,
        ],
      }),
    },
    {
      label: "电子邮件",
      value: extractWithPatterns(tenderItems, {
        titleKeywords: ["邮箱", "电子邮件", "E-mail"],
        regexes: [
          /(?:电子邮件|邮箱|E-?mail)\s*[：:]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
        ],
      }),
    },
  ];

  const projectContacts = [
    {
      name: extractWithPatterns(projectItems, {
        titleKeywords: ["项目联系人", "联系人"],
        regexes: [
          /(?:项目联系人|联系人)\s*[：:]\s*([^\n；;，,]+)/i,
        ],
      }),
      phone: extractWithPatterns(projectItems, {
        titleKeywords: ["项目联系电话", "联系电话", "电话"],
        regexes: [
          /(?:项目联系电话|联系电话|电话)\s*[：:]\s*([0-9\-()（）]{7,30})/i,
        ],
      }),
    },
  ];

  const projectFields: TenderTraceField[] = [
    {
      label: "项目编号",
      value: extractWithPatterns(projectItems, {
        titleKeywords: ["项目编号", "招标编号", "采购编号"],
        regexes: [
          /(?:项目编号|招标编号|采购编号)\s*[：:]\s*([A-Z0-9\-_\/]+)/i,
        ],
      }),
    },
    {
      label: "项目名称",
      value: extractWithPatterns(projectItems, {
        titleKeywords: ["项目名称", "项目"],
        regexes: [
          /(?:项目名称|项目)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "项目概况与招标范围",
      value: extractWithPatterns(projectItems, {
        titleKeywords: ["概况", "范围", "招标范围"],
        regexes: [
          /(?:项目概况|招标范围|采购范围|服务范围)\s*[：:]\s*([^\n]+)/i,
        ],
      }),
    },
    {
      label: "招标控制价",
      value: extractWithPatterns(projectItems, {
        titleKeywords: ["预算", "控制价", "最高限价"],
        regexes: [
          /(?:预算金额|预算|最高限价|招标控制价)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "是否接受联合体投标",
      value: extractWithPatterns(projectItems, {
        titleKeywords: ["联合体"],
        regexes: [
          /(?:是否接受联合体投标|接受联合体|联合体投标)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
  ];

  const timeFields: TenderTraceField[] = [
    {
      label: "投标文件递交截止日期",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["截止", "递交截止"],
        regexes: [
          /(?:投标文件递交截止时间|递交截止时间|投标截止时间|截止时间)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "投标文件递交地点",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["递交地点"],
        regexes: [
          /(?:投标文件递交地点|递交地点)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "开标时间",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["开标时间"],
        regexes: [
          /(?:开标时间)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "开标地点",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["开标地点"],
        regexes: [
          /(?:开标地点)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "澄清招标文件截止时间",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["澄清"],
        regexes: [
          /(?:澄清招标文件.*?截止时间|澄清截止时间)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "投标有效期",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["有效期"],
        regexes: [
          /(?:投标有效期)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "信息公示媒体",
      value: extractWithPatterns(timeItems, {
        titleKeywords: ["公示媒体", "发布媒介", "公告媒介"],
        regexes: [
          /(?:信息公示媒体|发布媒介|公告媒介)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
  ];

  const otherFields: TenderTraceField[] = [
    {
      label: "投标费用承担",
      value: extractWithPatterns(otherItems, {
        titleKeywords: ["投标费用"],
        regexes: [
          /(?:投标费用承担|投标费用)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "是否退还投标文件",
      value: extractWithPatterns(otherItems, {
        titleKeywords: ["退还投标文件"],
        regexes: [
          /(?:是否退还投标文件|退还投标文件)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "偏离",
      value: extractWithPatterns(otherItems, {
        titleKeywords: ["偏离"],
        regexes: [
          /(?:偏离)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "评标办法",
      value: extractWithPatterns(otherItems, {
        titleKeywords: ["评标办法"],
        regexes: [
          /(?:评标办法)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
    {
      label: "定标方法",
      value: extractWithPatterns(otherItems, {
        titleKeywords: ["定标方法"],
        regexes: [
          /(?:定标方法)\s*[：:]\s*([^\n；;]+)/i,
        ],
      }),
    },
  ];

  return {
    tenderName,
    tenderContacts,
    projectContacts,
    projectFields,
    timeFields,
    otherFields,
    purchaseGroups,
  };
}
