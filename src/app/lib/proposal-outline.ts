import type { FlattenedOutlineNode, OutlineGroup, OutlineNode } from "../types/proposal";

function createOutlineId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const OUTLINE_TITLE_PREFIX_PATTERNS = [
  /^第[一二三四五六七八九十百千万零〇\d]+[章节篇部分]\s*/u,
  /^[一二三四五六七八九十百千万零〇]+、\s*/u,
  /^\d+(?:\.\d+){0,5}(?:[、.)．]|\s)+/u,
];

export function stripOutlineTitlePrefix(title: string) {
  let next = title.trim();
  let changed = true;

  while (next && changed) {
    changed = false;
    for (const pattern of OUTLINE_TITLE_PREFIX_PATTERNS) {
      const stripped = next.replace(pattern, "").trim();
      if (stripped && stripped !== next) {
        next = stripped;
        changed = true;
      }
    }
  }

  return next || title.trim();
}

function normalizeNode(source: unknown, fallbackTitle: string): OutlineNode | null {
  if (typeof source === "string") {
    const title = source.trim();
    if (!title) return null;
    return {
      id: createOutlineId("node"),
      title,
      children: [],
    };
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const record = source as Record<string, unknown>;
  const title =
    typeof record.title === "string"
      ? stripOutlineTitlePrefix(record.title)
      : typeof record.name === "string"
        ? stripOutlineTitlePrefix(record.name)
        : "";
  const detail =
    typeof record.detail === "string"
      ? record.detail.trim()
      : typeof record.description === "string"
        ? record.description.trim()
        : undefined;
  const childSource = Array.isArray(record.children)
    ? record.children
    : Array.isArray(record.sections)
      ? record.sections
      : [];

  const children = childSource
    .map((item, index) => normalizeNode(item, `${fallbackTitle}-${index + 1}`))
    .filter((item): item is OutlineNode => item !== null);

  if (!title && children.length === 0) {
    return null;
  }

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : createOutlineId("node"),
    title: title || fallbackTitle,
    detail,
    sourceItemIds: Array.isArray(record.sourceItemIds)
      ? Array.from(
          new Set(
            record.sourceItemIds
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        )
      : undefined,
    sourceType:
      record.sourceType === "tender" || record.sourceType === "inferred" || record.sourceType === "reference"
        ? record.sourceType
        : undefined,
    boundRequirementText:
      typeof record.boundRequirementText === "string" && record.boundRequirementText.trim()
        ? record.boundRequirementText.trim()
        : undefined,
    children,
  };
}

export function normalizeOutlineGroups(source: unknown, fallbackGroupLabel: string): OutlineGroup[] {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const group =
        typeof record.group === "string"
          ? record.group.trim()
          : typeof record.title === "string"
            ? record.title.trim()
            : `${fallbackGroupLabel}${index + 1}`;
      const detail = typeof record.detail === "string" ? record.detail.trim() : undefined;
      const sectionSource = Array.isArray(record.sections)
        ? record.sections
        : Array.isArray(record.children)
          ? record.children
          : [];
      const sections = sectionSource
        .map((entry, sectionIndex) => normalizeNode(entry, `标题${sectionIndex + 1}`))
        .filter((entry): entry is OutlineNode => entry !== null);

      return {
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : createOutlineId("group"),
        group,
        detail,
        sections,
      } satisfies OutlineGroup;
    })
    .filter((item): item is OutlineGroup => item !== null);
}

function toChineseNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];

  if (value <= 10) {
    return value === 10 ? "十" : digits[value];
  }

  return String(value)
    .split("")
    .map((digit, index, array) => {
      const numeric = Number(digit);
      const unit = units[array.length - index - 1];
      if (numeric === 0) {
        return "零";
      }
      return `${digits[numeric]}${unit}`;
    })
    .join("")
    .replace(/零+/g, "零")
    .replace(/零$/g, "")
    .replace(/^一十/, "十");
}

export function buildOutlineNumbering(pathIndexes: number[]) {
  if (pathIndexes.length === 0) return "";
  if (pathIndexes.length === 1) {
    return `${toChineseNumber(pathIndexes[0])}、`;
  }
  return pathIndexes.join(".");
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
      const nextIndexes = pathIndexes.length === 0 ? [++rootIndex] : [...pathIndexes, index + 1];
      const nextTitles = [...pathTitles, node.title];

      flattened.push({
        id: node.id,
        title: node.title,
        detail: node.detail,
        sourceItemIds: node.sourceItemIds,
        sourceType: node.sourceType,
        boundRequirementText: node.boundRequirementText,
        numbering: buildOutlineNumbering(nextIndexes),
        level: nextIndexes.length,
        groupLabel,
        pathTitles: nextTitles,
        sectionPath: [groupLabel, ...nextTitles].join(" / "),
      });

      if (node.children.length > 0) {
        walk(groupLabel, node.children, nextTitles, nextIndexes);
      }
    });
  };

  groups.forEach((group) => {
    walk(group.group, group.sections, [], []);
  });

  return flattened;
}

function updateNodes(nodes: OutlineNode[], nodeId: string, updater: (node: OutlineNode) => OutlineNode): OutlineNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return updater(node);
    }

    if (node.children.length === 0) {
      return node;
    }

    return {
      ...node,
      children: updateNodes(node.children, nodeId, updater),
    };
  });
}

export function updateOutlineNode(groups: OutlineGroup[], nodeId: string, updater: (node: OutlineNode) => OutlineNode) {
  return groups.map((group) => ({
    ...group,
    sections: updateNodes(group.sections, nodeId, updater),
  }));
}

function removeNodeFromNodes(nodes: OutlineNode[], nodeId: string): OutlineNode[] {
  return nodes
    .filter((node) => node.id !== nodeId)
    .map((node) => ({
      ...node,
      children: removeNodeFromNodes(node.children, nodeId),
    }));
}

export function removeOutlineNode(groups: OutlineGroup[], nodeId: string) {
  return groups.map((group) => ({
    ...group,
    sections: removeNodeFromNodes(group.sections, nodeId),
  }));
}

function addSiblingInNodes(nodes: OutlineNode[], nodeId: string): OutlineNode[] {
  const next: OutlineNode[] = [];
  nodes.forEach((node) => {
    next.push({
      ...node,
      children: addSiblingInNodes(node.children, nodeId),
    });
    if (node.id === nodeId) {
      next.push({
        id: createOutlineId("node"),
        title: "新章节",
        detail: "",
        children: [],
      });
    }
  });
  return next;
}

export function addOutlineSibling(groups: OutlineGroup[], nodeId: string) {
  return groups.map((group) => ({
    ...group,
    sections: addSiblingInNodes(group.sections, nodeId),
  }));
}

export function addOutlineChild(groups: OutlineGroup[], nodeId: string) {
  return updateOutlineNode(groups, nodeId, (node) => ({
    ...node,
    children: [
      ...node.children,
      {
        id: createOutlineId("node"),
        title: "新子章节",
        detail: "",
        children: [],
      },
    ],
  }));
}

function moveNodeInNodes(nodes: OutlineNode[], nodeId: string, direction: "up" | "down"): OutlineNode[] {
  const next = nodes.map((node) => ({
    ...node,
    children: moveNodeInNodes(node.children, nodeId, direction),
  }));
  const index = next.findIndex((node) => node.id === nodeId);
  if (index < 0) {
    return next;
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= next.length) {
    return next;
  }

  const swapped = [...next];
  [swapped[index], swapped[targetIndex]] = [swapped[targetIndex], swapped[index]];
  return swapped;
}

export function moveOutlineNode(groups: OutlineGroup[], nodeId: string, direction: "up" | "down") {
  return groups.map((group) => ({
    ...group,
    sections: moveNodeInNodes(group.sections, nodeId, direction),
  }));
}

export function createEmptyOutlineGroup(group: string): OutlineGroup {
  return {
    id: createOutlineId("group"),
    group,
    sections: [
      {
        id: createOutlineId("node"),
        title: "一级标题",
        detail: "",
        children: [],
      },
    ],
  };
}
