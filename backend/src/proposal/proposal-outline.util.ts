import { createHash } from 'crypto';

export type OutlineNodeSourceType = 'tender' | 'inferred' | 'reference';

export type OutlineNode = {
  id: string;
  title: string;
  detail?: string;
  sourceItemIds?: string[];
  sourceType?: OutlineNodeSourceType;
  boundRequirementText?: string;
  children: OutlineNode[];
};

export type OutlineGroup = {
  id: string;
  group: string;
  detail?: string;
  sections: OutlineNode[];
};

export type FlattenedOutlineNode = {
  id: string;
  title: string;
  detail?: string;
  sourceItemIds?: string[];
  sourceType?: OutlineNodeSourceType;
  boundRequirementText?: string;
  level: number;
  numbering: string;
  groupLabel: string;
  pathTitles: string[];
  sectionPath: string;
};

type RawRecord = Record<string, unknown>;

const MAX_OUTLINE_LEVEL = 5;
const OUTLINE_TITLE_PREFIX_PATTERNS = [
  /^第[一二三四五六七八九十百千万零〇\d]+[章节篇部分]\s*/u,
  /^[一二三四五六七八九十百千万零〇]+、\s*/u,
  /^\d+(?:\.\d+){0,5}(?:[、.)．]|\s)+/u,
];

function asRecord(value: unknown): RawRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as RawRecord;
}

function readFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

export function stripOutlineTitlePrefix(title: string) {
  let next = title.trim();
  let changed = true;

  while (next && changed) {
    changed = false;
    for (const pattern of OUTLINE_TITLE_PREFIX_PATTERNS) {
      const stripped = next.replace(pattern, '').trim();
      if (stripped && stripped !== next) {
        next = stripped;
        changed = true;
      }
    }
  }

  return next || title.trim();
}

function normalizeSourceType(value: unknown): OutlineNodeSourceType | undefined {
  if (value === 'tender' || value === 'inferred' || value === 'reference') {
    return value;
  }
  return undefined;
}

function toStableId(seed: string) {
  return `outline_${createHash('sha1').update(seed).digest('hex').slice(0, 12)}`;
}

function normalizeChildren(
  source: unknown,
  parentSeed: string,
  level: number,
): OutlineNode[] {
  if (!Array.isArray(source) || level > MAX_OUTLINE_LEVEL) {
    return [];
  }

  return source
    .map((item, index) => normalizeNode(item, `${parentSeed}:${index + 1}`, level))
    .filter((item): item is OutlineNode => item !== null);
}

function normalizeNode(
  source: unknown,
  seed: string,
  level: number,
): OutlineNode | null {
  if (level > MAX_OUTLINE_LEVEL) {
    return null;
  }

  if (typeof source === 'string') {
    const title = source.trim();
    if (!title) {
      return null;
    }
    return {
      id: toStableId(`${seed}:${title}`),
      title,
      children: [],
    };
  }

  const record = asRecord(source);
  if (!record) {
    return null;
  }

  const rawTitle = readFirstString(record.title, record.name, record.label);
  const title = rawTitle ? stripOutlineTitlePrefix(rawTitle) : '';
  const detail = readFirstString(record.detail, record.description, record.note) || undefined;
  const children = normalizeChildren(
    record.children ?? record.sections,
    `${seed}:${title || 'node'}`,
    level + 1,
  );

  if (!title && children.length === 0) {
    return null;
  }

  return {
    id: readFirstString(record.id) || toStableId(`${seed}:${title || 'node'}`),
    title: title || `未命名标题${level}`,
    detail,
    sourceItemIds: readStringArray(record.sourceItemIds),
    sourceType: normalizeSourceType(record.sourceType),
    boundRequirementText: readFirstString(record.boundRequirementText) || undefined,
    children,
  };
}

export function normalizeOutlineGroups(source: unknown): OutlineGroup[] {
  if (!Array.isArray(source)) {
    return [];
  }

  const groups: Array<OutlineGroup | null> = source
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const group = readFirstString(record.group, record.title, record.label);
      const detail = readFirstString(record.detail, record.description, record.note) || undefined;
      const sections = normalizeChildren(
        record.sections ?? record.children,
        `group:${group || index + 1}`,
        1,
      );

      if (!group && sections.length === 0) {
        return null;
      }

      return {
        id: readFirstString(record.id) || toStableId(`group:${index + 1}:${group || 'group'}`),
        group: group || `分组${index + 1}`,
        detail,
        sections,
      };
    });

  return groups.filter((item): item is OutlineGroup => item !== null);
}

function toChineseNumber(value: number) {
  const units = ['', '十', '百', '千'];
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  if (value <= 10) {
    if (value === 10) {
      return '十';
    }
    return digits[value];
  }

  const parts = String(value)
    .split('')
    .map((digit, index, array) => {
      const numeric = Number(digit);
      const unit = units[array.length - index - 1];
      if (numeric === 0) {
        return '零';
      }
      return `${digits[numeric]}${unit}`;
    })
    .join('')
    .replace(/零+/g, '零')
    .replace(/零$/g, '')
    .replace(/^一十/, '十');

  return parts || String(value);
}

export function buildOutlineNumbering(pathIndexes: number[]) {
  if (pathIndexes.length === 0) {
    return '';
  }

  if (pathIndexes.length === 1) {
    return `${toChineseNumber(pathIndexes[0])}、`;
  }

  return pathIndexes.join('.');
}

export function flattenOutlineGroups(groups: OutlineGroup[]): FlattenedOutlineNode[] {
  const flattened: FlattenedOutlineNode[] = [];
  let rootIndex = 0;

  const walk = (
    groupLabel: string,
    nodes: OutlineNode[],
    pathTitles: string[],
    pathIndexes: number[],
  ) => {
    nodes.forEach((node, index) => {
      const nextPathTitles = [...pathTitles, node.title];
      const nextPathIndexes =
        pathIndexes.length === 0 ? [++rootIndex] : [...pathIndexes, index + 1];

      flattened.push({
        id: node.id,
        title: node.title,
        detail: node.detail,
        sourceItemIds: node.sourceItemIds,
        sourceType: node.sourceType,
        boundRequirementText: node.boundRequirementText,
        level: Math.min(nextPathIndexes.length, MAX_OUTLINE_LEVEL),
        numbering: buildOutlineNumbering(nextPathIndexes),
        groupLabel,
        pathTitles: nextPathTitles,
        sectionPath: [groupLabel, ...nextPathTitles].join(' / '),
      });

      if (node.children.length > 0) {
        walk(groupLabel, node.children, nextPathTitles, nextPathIndexes);
      }
    });
  };

  groups.forEach((group) => {
    walk(group.group, group.sections, [], []);
  });

  return flattened;
}
