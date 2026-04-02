import { DOMParser, XMLSerializer, type Node as XmlNode } from '@xmldom/xmldom';
import * as path from 'path';
import JSZip = require('jszip');

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export type DocxBodyEntry = {
  index: number;
  text: string;
  normalizedText: string;
  nodeType: string;
};

function normalizeDocxText(value?: string | null) {
  return (value ?? '').replace(/[\s\u00A0]+/g, '').trim();
}

function getLocalName(node: XmlNode) {
  if ('localName' in node && typeof node.localName === 'string' && node.localName) {
    return node.localName;
  }
  return node.nodeName.split(':').pop() ?? node.nodeName;
}

function getElementChildren(node: XmlNode) {
  return Array.from(node.childNodes).filter((child) => child.nodeType === node.ELEMENT_NODE);
}

function findElementsByLocalName(node: XmlNode, localName: string) {
  const matches: XmlNode[] = [];
  const visit = (current: XmlNode) => {
    if (current.nodeType === current.ELEMENT_NODE && getLocalName(current) === localName) {
      matches.push(current);
    }
    Array.from(current.childNodes).forEach((child) => visit(child));
  };
  visit(node);
  return matches;
}

function extractNodeText(node: XmlNode): string {
  if (node.nodeType === node.TEXT_NODE) {
    return node.nodeValue ?? '';
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    return '';
  }

  const localName = getLocalName(node);
  if (localName === 'tab') {
    return '\t';
  }
  if (localName === 'br' || localName === 'cr') {
    return '\n';
  }

  let text = '';
  for (let index = 0; index < node.childNodes.length; index += 1) {
    text += extractNodeText(node.childNodes[index]);
  }
  return text;
}

function buildNgramSet(text: string, size = 5) {
  if (!text) {
    return new Set<string>();
  }
  if (text.length <= size) {
    return new Set([text]);
  }

  const set = new Set<string>();
  for (let index = 0; index <= text.length - size; index += 1) {
    set.add(text.slice(index, index + size));
  }
  return set;
}

function scoreEntryText(entryText: string, target: string) {
  if (!entryText || !target) {
    return 0;
  }
  if (entryText === target) {
    return 1000;
  }
  if (entryText.includes(target)) {
    return 800 + Math.min(target.length, 200);
  }
  if (target.includes(entryText) && entryText.length >= 8) {
    return 500 + Math.min(entryText.length, 100);
  }

  const targetGrams = buildNgramSet(target);
  if (targetGrams.size === 0) {
    return 0;
  }
  const entryGrams = buildNgramSet(entryText);
  let overlap = 0;
  targetGrams.forEach((gram) => {
    if (entryGrams.has(gram)) {
      overlap += 1;
    }
  });
  return (overlap / targetGrams.size) * 100;
}

function selectBestCluster(matches: Array<{ index: number; score: number }>) {
  if (matches.length === 0) {
    return null;
  }

  const sorted = [...matches].sort((left, right) => left.index - right.index);
  const clusters: Array<Array<{ index: number; score: number }>> = [];
  let current: Array<{ index: number; score: number }> = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    const previous = current[current.length - 1];
    if (next.index - previous.index <= 18) {
      current.push(next);
      continue;
    }
    clusters.push(current);
    current = [next];
  }
  clusters.push(current);

  return clusters.sort((left, right) => {
    const leftScore = left.reduce((total, item) => total + item.score, 0);
    const rightScore = right.reduce((total, item) => total + item.score, 0);
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    const leftSpan = left[left.length - 1].index - left[0].index;
    const rightSpan = right[right.length - 1].index - right[0].index;
    return leftSpan - rightSpan;
  })[0];
}

async function loadDocxDocument(sourceBuffer: Buffer) {
  const zip = await JSZip.loadAsync(sourceBuffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    return null;
  }

  const xml = await documentFile.async('string');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const body = document.getElementsByTagName('w:body')[0];
  if (!body) {
    return null;
  }

  const contentNodes = getElementChildren(body).filter((node) => getLocalName(node) !== 'sectPr');
  const sectionProperties = getElementChildren(body).find((node) => getLocalName(node) === 'sectPr') ?? null;

  return {
    zip,
    document,
    body,
    contentNodes,
    sectionProperties,
  };
}

function buildBodyEntries(contentNodes: XmlNode[]): DocxBodyEntry[] {
  return contentNodes.map((node, index) => {
    const text = extractNodeText(node).replace(/[\u00A0\s]+/g, ' ').trim();
    return {
      index,
      text,
      normalizedText: normalizeDocxText(text),
      nodeType: getLocalName(node),
    };
  });
}

function relationshipFilePath(partPath: string) {
  const normalized = partPath.replace(/^\/+/, '');
  const directory = path.posix.dirname(normalized);
  const fileName = path.posix.basename(normalized);
  return directory === '.'
    ? `_rels/${fileName}.rels`
    : `${directory}/_rels/${fileName}.rels`;
}

function resolveRelationshipTarget(partPath: string, target: string) {
  const normalizedTarget = target.trim();
  if (!normalizedTarget || /^[a-z]+:/i.test(normalizedTarget)) {
    return null;
  }

  if (normalizedTarget.startsWith('/')) {
    return normalizedTarget.replace(/^\/+/, '');
  }

  const baseDirectory = path.posix.dirname(partPath);
  return path.posix.normalize(path.posix.join(baseDirectory, normalizedTarget));
}

function collectRelationshipIds(node: XmlNode, ids: Set<string>) {
  if (node.nodeType !== node.ELEMENT_NODE) {
    return;
  }

  const element = node as unknown as { attributes?: { length: number; item(index: number): { nodeName: string; nodeValue: string | null } | null } };
  const length = element.attributes?.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const attribute = element.attributes?.item(index);
    if (!attribute?.nodeValue) {
      continue;
    }

    if (attribute.nodeName === 'r:id' || attribute.nodeName === 'r:embed' || attribute.nodeName === 'r:link') {
      ids.add(attribute.nodeValue);
    }
  }

  Array.from(node.childNodes).forEach((child) => collectRelationshipIds(child, ids));
}

async function pruneUnusedMainDocumentRelationships(zip: JSZip, body: XmlNode, partPath: string) {
  const relsPath = relationshipFilePath(partPath);
  const relsFile = zip.file(relsPath);
  if (!relsFile) {
    return;
  }

  const relsXml = await relsFile.async('string');
  const relsDocument = new DOMParser().parseFromString(relsXml, 'application/xml');
  const relationships = findElementsByLocalName(relsDocument, 'Relationship');
  if (relationships.length === 0) {
    return;
  }

  const usedIds = new Set<string>();
  collectRelationshipIds(body, usedIds);

  let changed = false;
  for (const relationship of relationships) {
    const element = relationship as unknown as {
      getAttribute(name: string): string | null;
      parentNode?: { removeChild(node: XmlNode): void };
    };
    const targetMode = element.getAttribute('TargetMode');
    const id = element.getAttribute('Id') ?? '';
    const target = element.getAttribute('Target') ?? '';
    const resolvedTarget = resolveRelationshipTarget(partPath, target);

    if (targetMode === 'External' || !resolvedTarget) {
      continue;
    }

    const isHeavyPart =
      resolvedTarget.startsWith('word/media/') ||
      resolvedTarget.startsWith('word/embeddings/');
    if (!isHeavyPart || usedIds.has(id)) {
      continue;
    }

    element.parentNode?.removeChild(relationship);
    changed = true;
  }

  if (!changed) {
    return;
  }

  const serialized = new XMLSerializer().serializeToString(relsDocument);
  zip.file(relsPath, serialized.startsWith('<?xml') ? serialized : `${XML_DECLARATION}${serialized}`);
}

async function collectReferencedBinaryParts(zip: JSZip, startParts: string[]) {
  const keep = new Set<string>(startParts);
  const visitedParts = new Set<string>();
  const queue = [...startParts];

  while (queue.length > 0) {
    const partPath = queue.shift()!;
    if (visitedParts.has(partPath)) {
      continue;
    }
    visitedParts.add(partPath);

    const relsPath = relationshipFilePath(partPath);
    const relsFile = zip.file(relsPath);
    if (!relsFile) {
      continue;
    }

    keep.add(relsPath);
    const relsXml = await relsFile.async('string');
    const relsDocument = new DOMParser().parseFromString(relsXml, 'application/xml');
    const relationships = findElementsByLocalName(relsDocument, 'Relationship');

    for (const relationship of relationships) {
      const element = relationship as unknown as { getAttribute(name: string): string | null };
      if (element.getAttribute('TargetMode') === 'External') {
        continue;
      }

      const target = element.getAttribute('Target') ?? '';
      const resolvedTarget = resolveRelationshipTarget(partPath, target);
      if (!resolvedTarget || !zip.file(resolvedTarget)) {
        continue;
      }

      keep.add(resolvedTarget);
      if (resolvedTarget.endsWith('.xml')) {
        queue.push(resolvedTarget);
      }
    }
  }

  return keep;
}

function pruneUnusedBinaryParts(zip: JSZip, keep: Set<string>) {
  zip.forEach((relativePath) => {
    const isHeavyPart =
      relativePath.startsWith('word/media/') ||
      relativePath.startsWith('word/embeddings/');
    if (isHeavyPart && !keep.has(relativePath)) {
      zip.remove(relativePath);
    }
  });
}

function writeDocumentXml(zip: JSZip, document: unknown) {
  const serialized = new XMLSerializer().serializeToString(document as Parameters<XMLSerializer['serializeToString']>[0]);
  zip.file('word/document.xml', serialized.startsWith('<?xml') ? serialized : `${XML_DECLARATION}${serialized}`);
}

async function generateSubsetBuffer(params: {
  zip: JSZip;
  document: unknown;
  body: XmlNode;
  sectionProperties: XmlNode | null;
  selectedNodes: XmlNode[];
}) {
  while (params.body.firstChild) {
    params.body.removeChild(params.body.firstChild);
  }

  params.selectedNodes.forEach((node) => {
    params.body.appendChild(node.cloneNode(true));
  });

  if (params.sectionProperties) {
    params.body.appendChild(params.sectionProperties.cloneNode(true));
  }

  await pruneUnusedMainDocumentRelationships(params.zip, params.body, 'word/document.xml');
  writeDocumentXml(params.zip, params.document);
  const keep = await collectReferencedBinaryParts(params.zip, ['word/document.xml']);
  pruneUnusedBinaryParts(params.zip, keep);
  return params.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function extractDocxBodyEntries(sourceBuffer: Buffer) {
  const loaded = await loadDocxDocument(sourceBuffer);
  if (!loaded) {
    return [];
  }

  return buildBodyEntries(loaded.contentNodes);
}

export async function extractDocxEntryRangeBuffer(
  sourceBuffer: Buffer,
  startIndex: number,
  endIndex: number,
) {
  const loaded = await loadDocxDocument(sourceBuffer);
  if (!loaded) {
    return null;
  }

  const { contentNodes } = loaded;
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    startIndex >= contentNodes.length ||
    endIndex >= contentNodes.length
  ) {
    return null;
  }

  return generateSubsetBuffer({
    zip: loaded.zip,
    document: loaded.document,
    body: loaded.body,
    sectionProperties: loaded.sectionProperties,
    selectedNodes: contentNodes.slice(startIndex, endIndex + 1),
  });
}

export async function extractDocxSubsetBuffer(
  sourceBuffer: Buffer,
  blockTexts: string[],
  hintTexts: string[] = [],
) {
  const loaded = await loadDocxDocument(sourceBuffer);
  if (!loaded) {
    return null;
  }

  const entries = loaded.contentNodes.map((node, index) => ({
    index,
    node,
    text: normalizeDocxText(extractNodeText(node)),
  }));

  const targets = Array.from(
    new Set(
      [...blockTexts, ...hintTexts]
        .map((value) => normalizeDocxText(value))
        .filter((value) => value.length >= 4),
    ),
  );

  if (entries.length === 0 || targets.length === 0) {
    return null;
  }

  const matches: Array<{ index: number; score: number }> = [];
  let cursor = 0;
  for (const target of targets) {
    let bestIndex = -1;
    let bestScore = 0;

    const searchWindows: Array<[number, number]> = [
      [cursor, entries.length],
      [0, entries.length],
    ];

    for (const [start, end] of searchWindows) {
      for (let index = start; index < end; index += 1) {
        const score = scoreEntryText(entries[index].text, target);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      if (bestScore >= 24) {
        break;
      }
    }

    if (bestIndex >= 0 && bestScore >= 24) {
      matches.push({ index: bestIndex, score: bestScore });
      cursor = Math.max(bestIndex, cursor);
    }
  }

  const cluster = selectBestCluster(matches);
  if (!cluster || cluster.length === 0) {
    return null;
  }

  let startIndex = cluster[0].index;
  let endIndex = cluster[cluster.length - 1].index;
  const normalizedHints = hintTexts.map((value) => normalizeDocxText(value)).filter((value) => value.length >= 2);

  for (let offset = 1; offset <= 3; offset += 1) {
    const index = startIndex - offset;
    if (index < 0) {
      break;
    }
    const entry = entries[index];
    if (!entry.text) {
      startIndex = index;
      continue;
    }
    if (normalizedHints.some((hint) => entry.text.includes(hint) || hint.includes(entry.text))) {
      startIndex = index;
      continue;
    }
    if (entry.text.length <= 12) {
      startIndex = index;
    }
  }

  return generateSubsetBuffer({
    zip: loaded.zip,
    document: loaded.document,
    body: loaded.body,
    sectionProperties: loaded.sectionProperties,
    selectedNodes: entries.slice(startIndex, endIndex + 1).map((entry) => entry.node),
  });
}
