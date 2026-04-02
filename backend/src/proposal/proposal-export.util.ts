import { DOMParser } from '@xmldom/xmldom';
import type { Element, Node } from '@xmldom/xmldom';
import {
  AlignmentType,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
} from 'docx';
import type { IParagraphOptions, IRunOptions, ParagraphChild } from 'docx';
import type { OutlineGroup } from './proposal-outline.util';
import { flattenOutlineGroups } from './proposal-outline.util';

type ExportKind = 'tech' | 'biz';

type ExportPayload = {
  projectName: string;
  kind: ExportKind;
  outlineGroups: OutlineGroup[];
  sectionContentMap: Map<string, string>;
};

type InlineMarks = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fontFamily?: string;
  fontSizeHalfPt?: number;
};

type ParagraphPreset = {
  fontSize: number;
  bold: boolean;
  line: number;
  firstLine?: number;
};

const SONG_TI = '宋体';
const BODY_PRESET: ParagraphPreset = {
  fontSize: 21,
  bold: false,
  line: 360,
  firstLine: 420,
};

const HEADING_PRESET_BY_LEVEL: Record<number, ParagraphPreset> = {
  1: { fontSize: 32, bold: true, line: 480, firstLine: 0 },
  2: { fontSize: 30, bold: true, line: 480, firstLine: 0 },
  3: { fontSize: 28, bold: true, line: 480, firstLine: 0 },
  4: { fontSize: 24, bold: true, line: 360, firstLine: 0 },
  5: { fontSize: 21, bold: true, line: 360, firstLine: 0 },
};

function parseStyle(styleText?: string | null) {
  const styleMap = new Map<string, string>();
  if (!styleText) {
    return styleMap;
  }

  styleText
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [key, ...rest] = part.split(':');
      if (!key || rest.length === 0) {
        return;
      }
      styleMap.set(key.trim().toLowerCase(), rest.join(':').trim());
    });

  return styleMap;
}

function parseColor(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.slice(1).toUpperCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, a, b, c] = trimmed;
    return `${a}${a}${b}${b}${c}${c}`.toUpperCase();
  }

  return undefined;
}

function parseFontSizeHalfPt(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const matched = value.trim().match(/^([\d.]+)(px|pt)?$/i);
  if (!matched) {
    return undefined;
  }

  const numeric = Number(matched[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  const unit = matched[2]?.toLowerCase() || 'px';
  const pt = unit === 'pt' ? numeric : numeric * 0.75;
  return Math.max(16, Math.round(pt * 2));
}

function parseImageSizePx(value?: string | null, fallback = 320) {
  if (!value) {
    return fallback;
  }

  const matched = value.trim().match(/^([\d.]+)(px)?$/i);
  if (!matched) {
    return fallback;
  }

  const numeric = Number(matched[1]);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.round(numeric);
}

function mergeMarks(base: InlineMarks, next: InlineMarks): InlineMarks {
  return {
    ...base,
    ...next,
  };
}

function marksToRunOptions(text: string, marks: InlineMarks, fallback: ParagraphPreset): IRunOptions {
  return {
    text,
    bold: marks.bold ?? fallback.bold,
    italics: marks.italic,
    underline: marks.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: marks.strike,
    color: marks.color,
    font: marks.fontFamily || SONG_TI,
    size: marks.fontSizeHalfPt ?? fallback.fontSize,
  };
}

function normalizeTextValue(value: string) {
  return value.replace(/\u00a0/g, ' ');
}

function extractParagraphAlignment(node: Element) {
  const styleMap = parseStyle(node.getAttribute('style'));
  const textAlign = styleMap.get('text-align')?.toLowerCase();
  if (textAlign === 'center') {
    return AlignmentType.CENTER;
  }
  if (textAlign === 'right') {
    return AlignmentType.RIGHT;
  }
  if (textAlign === 'justify') {
    return AlignmentType.JUSTIFIED;
  }
  return AlignmentType.LEFT;
}

function buildInlineMarks(node: Element, inherited: InlineMarks): InlineMarks {
  const tag = node.tagName.toLowerCase();
  const styleMap = parseStyle(node.getAttribute('style'));

  const next: InlineMarks = {};

  if (tag === 'strong' || tag === 'b') {
    next.bold = true;
  }
  if (tag === 'em' || tag === 'i') {
    next.italic = true;
  }
  if (tag === 'u') {
    next.underline = true;
  }
  if (tag === 's' || tag === 'strike') {
    next.strike = true;
  }

  const fontWeight = styleMap.get('font-weight');
  if (fontWeight && (fontWeight === 'bold' || Number(fontWeight) >= 600)) {
    next.bold = true;
  }

  const fontStyle = styleMap.get('font-style');
  if (fontStyle === 'italic') {
    next.italic = true;
  }

  const textDecoration = styleMap.get('text-decoration') || styleMap.get('text-decoration-line');
  if (textDecoration?.includes('underline')) {
    next.underline = true;
  }
  if (textDecoration?.includes('line-through')) {
    next.strike = true;
  }

  next.color = parseColor(styleMap.get('color')) || inherited.color;
  next.fontFamily =
    styleMap.get('font-family')
      ?.split(',')
      .map((item) => item.replace(/["']/g, '').trim())
      .find(Boolean) || inherited.fontFamily;
  next.fontSizeHalfPt = parseFontSizeHalfPt(styleMap.get('font-size')) || inherited.fontSizeHalfPt;

  return mergeMarks(inherited, next);
}

function buildImageRun(node: Element) {
  const src = node.getAttribute('src') || '';
  const matched = src.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched?.[1] || !matched[2]) {
    return null;
  }

  const imageType = matched[1].toLowerCase();
  if (imageType === 'svg+xml') {
    return null;
  }
  const docxImageType =
    imageType === 'jpeg'
      ? 'jpg'
      : imageType === 'png' || imageType === 'gif' || imageType === 'bmp'
        ? imageType
        : null;
  if (!docxImageType) {
    return null;
  }

  const styleMap = parseStyle(node.getAttribute('style'));
  const width = Math.min(
    560,
    parseImageSizePx(styleMap.get('width') || node.getAttribute('width'), 320),
  );
  const height = Math.min(
    720,
    parseImageSizePx(styleMap.get('height') || node.getAttribute('height'), Math.round(width * 0.75)),
  );

  return new ImageRun({
    type: docxImageType,
    data: Buffer.from(matched[2], 'base64'),
    transformation: {
      width,
      height,
    },
  });
}

function buildInlineChildren(
  nodes: ArrayLike<Node>,
  inherited: InlineMarks,
  fallback: ParagraphPreset,
): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  Array.from(nodes).forEach((node) => {
    if (node.nodeType === 3) {
      const text = normalizeTextValue(node.nodeValue || '');
      if (text) {
        children.push(new TextRun(marksToRunOptions(text, inherited, fallback)));
      }
      return;
    }

    if (node.nodeType !== 1) {
      return;
    }

    const element = node as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === 'br') {
      children.push(new TextRun({ break: 1 }));
      return;
    }

    if (tag === 'img') {
      const imageRun = buildImageRun(element);
      if (imageRun) {
        children.push(imageRun);
      }
      return;
    }

    const nextMarks = buildInlineMarks(element, inherited);
    children.push(...buildInlineChildren(Array.from(element.childNodes) as Node[], nextMarks, fallback));
  });

  return children;
}

function buildBodyParagraph(
  node: Element,
  fallback: ParagraphPreset = BODY_PRESET,
): Paragraph[] {
  const children = buildInlineChildren(Array.from(node.childNodes) as Node[], {}, fallback);
  if (children.length === 0) {
    return [];
  }

  return [
    new Paragraph({
      alignment: extractParagraphAlignment(node),
      children,
      spacing: {
        line: fallback.line,
      },
      indent: {
        firstLine: fallback.firstLine ?? 0,
      },
    }),
  ];
}

function buildListParagraphs(listNode: Element, ordered: boolean): Paragraph[] {
  return Array.from(listNode.childNodes)
    .filter((item) => item.nodeType === 1 && (item as Element).tagName.toLowerCase() === 'li')
    .flatMap((item, index) => {
      const li = item as Element;
      const prefixChildren = ordered
        ? [new TextRun(marksToRunOptions(`${index + 1}. `, {}, BODY_PRESET))]
        : [];
      const contentChildren = buildInlineChildren(Array.from(li.childNodes) as Node[], {}, BODY_PRESET);
      if (contentChildren.length === 0) {
        return [];
      }

      const paragraphOptions: IParagraphOptions = {
        children: [...prefixChildren, ...contentChildren],
        spacing: {
          line: BODY_PRESET.line,
        },
        indent: ordered
          ? { left: 0, firstLine: BODY_PRESET.firstLine }
          : { left: 420, hanging: 210 },
        ...(ordered ? {} : { bullet: { level: 0 } }),
      };

      return [new Paragraph(paragraphOptions)];
    });
}

function buildImageParagraph(node: Element) {
  const imageRun = buildImageRun(node);
  if (!imageRun) {
    return [];
  }

  return [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [imageRun],
      spacing: {
        before: 80,
        after: 80,
        line: BODY_PRESET.line,
      },
      indent: {
        firstLine: 0,
      },
    }),
  ];
}

function buildHtmlParagraphsFromText(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, array) => line.length > 0 || (index > 0 && array[index - 1].length > 0))
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun(marksToRunOptions(line || ' ', {}, BODY_PRESET))],
          spacing: {
            line: BODY_PRESET.line,
          },
          indent: {
            firstLine: BODY_PRESET.firstLine,
          },
        }),
    );
}

function htmlToParagraphs(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (!trimmed.includes('<')) {
    return buildHtmlParagraphsFromText(trimmed);
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(`<root>${trimmed}</root>`, 'text/xml');
  const root = document.documentElement;
  if (!root) {
    return buildHtmlParagraphsFromText(trimmed);
  }
  const paragraphs: Paragraph[] = [];

  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === 3) {
      const text = normalizeTextValue(node.nodeValue || '').trim();
      if (text) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun(marksToRunOptions(text, {}, BODY_PRESET))],
            spacing: { line: BODY_PRESET.line },
            indent: { firstLine: BODY_PRESET.firstLine },
          }),
        );
      }
      return;
    }

    if (node.nodeType !== 1) {
      return;
    }

    const element = node as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === 'p' || tag === 'div' || tag === 'blockquote') {
      paragraphs.push(...buildBodyParagraph(element));
      return;
    }

    if (tag === 'ul') {
      paragraphs.push(...buildListParagraphs(element, false));
      return;
    }

    if (tag === 'ol') {
      paragraphs.push(...buildListParagraphs(element, true));
      return;
    }

    if (tag === 'img') {
      paragraphs.push(...buildImageParagraph(element));
      return;
    }

    paragraphs.push(...buildBodyParagraph(element));
  });

  return paragraphs;
}

function buildHeadingParagraph(
  level: number,
  numbering: string,
  title: string,
) {
  const preset = HEADING_PRESET_BY_LEVEL[level] || HEADING_PRESET_BY_LEVEL[5];

  return new Paragraph({
    children: [
      new TextRun({
        text: `${numbering} ${title}`.trim(),
        bold: preset.bold,
        font: SONG_TI,
        size: preset.fontSize,
      }),
    ],
    spacing: {
      line: preset.line,
      before: 120,
      after: 80,
    },
    indent: {
      firstLine: 0,
    },
    alignment: AlignmentType.LEFT,
  });
}

function buildDocTitle(projectName: string, kind: ExportKind) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      after: 240,
      line: 480,
    },
    children: [
      new TextRun({
        text: `${projectName}${kind === 'tech' ? '技术标' : '商务标'}`,
        bold: true,
        font: SONG_TI,
        size: 36,
      }),
    ],
  });
}

export async function buildProposalDocxBuffer(payload: ExportPayload) {
  const flattened = flattenOutlineGroups(payload.outlineGroups);
  const children: Paragraph[] = [buildDocTitle(payload.projectName, payload.kind)];

  flattened.forEach((section) => {
    children.push(buildHeadingParagraph(section.level, section.numbering, section.title));

    const content = payload.sectionContentMap.get(section.id)?.trim();
    if (!content) {
      children.push(
        new Paragraph({
          children: [new TextRun(marksToRunOptions(' ', {}, BODY_PRESET))],
          spacing: {
            line: BODY_PRESET.line,
          },
          indent: {
            firstLine: BODY_PRESET.firstLine,
          },
        }),
      );
      return;
    }

    const contentParagraphs = htmlToParagraphs(content);
    if (contentParagraphs.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun(marksToRunOptions(content, {}, BODY_PRESET))],
          spacing: {
            line: BODY_PRESET.line,
          },
          indent: {
            firstLine: BODY_PRESET.firstLine,
          },
        }),
      );
      return;
    }

    children.push(...contentParagraphs);
  });

  const document = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}
