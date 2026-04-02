const MOJIBAKE_PATTERN = /[ÃÂÅÄÆÇÐÑÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/;
const CJK_PATTERN = /[\u3400-\u9FFF]/;
const LATIN1_SEGMENT_PATTERN = /[\u0080-\u00FF]+/g;

function readableScore(value: string) {
  let score = 0;
  for (const char of value) {
    if (/[A-Za-z0-9]/.test(char)) {
      score += 1;
      continue;
    }
    if (CJK_PATTERN.test(char)) {
      score += 3;
      continue;
    }
    if (/[\s\-_.()（）【】《》、，。:：]/.test(char)) {
      score += 0.5;
    }
  }
  return score;
}

function decodeLatin1(value: string) {
  return Buffer.from(value, 'latin1').toString('utf8').trim();
}

function shouldUseDecoded(original: string, decoded: string) {
  if (!decoded || decoded === original) {
    return false;
  }

  const originalLooksBroken = MOJIBAKE_PATTERN.test(original) || original.includes('�');
  const decodedLooksReadable = CJK_PATTERN.test(decoded) || readableScore(decoded) > readableScore(original) + 1;
  const decodedLooksWorse = decoded.includes('�') || (MOJIBAKE_PATTERN.test(decoded) && !CJK_PATTERN.test(decoded));

  return decodedLooksReadable && (!decodedLooksWorse || originalLooksBroken);
}

function normalizeSegmentMojibake(value: string) {
  return value.replace(LATIN1_SEGMENT_PATTERN, (segment) => {
    try {
      const decoded = decodeLatin1(segment);
      return shouldUseDecoded(segment, decoded) ? decoded : segment;
    } catch {
      return segment;
    }
  });
}

export function normalizePossiblyMojibakeText(value?: string | null) {
  const original = (value ?? '').trim();
  if (!original) {
    return '';
  }

  try {
    let segmented = original;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const next = normalizeSegmentMojibake(segmented);
      if (next === segmented) {
        break;
      }
      segmented = next;
    }

    if (segmented !== original) {
      return segmented;
    }

    const decoded = decodeLatin1(original);
    if (shouldUseDecoded(original, decoded)) {
      return decoded;
    }
  } catch {
    // ignore decode failures and keep the original text
  }

  return original;
}

export function normalizeUploadedFileName(fileName?: string | null) {
  return normalizePossiblyMojibakeText(fileName) || 'unnamed';
}

export function buildSafeFileName(fileName: string) {
  return normalizeUploadedFileName(fileName)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
