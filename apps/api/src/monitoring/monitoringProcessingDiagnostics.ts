import { EXCERPT_MAX_CHARS, type MonitoringRawExcerpt } from '@wx-viewer-poc/shared';

/**
 * 7.3 のサニタイズ規約: 制御文字を除去する。
 * TAB / LF / CR は XML の整形を壊さないため残す。
 * HTMLエスケープ・マスキングは行わない（原文断片をそのまま診断に使うため）。
 */
const CONTROL_CHAR_CODE_POINTS: readonly number[] = (() => {
  const codes: number[] = [];
  for (let c = 0x00; c <= 0x08; c += 1) codes.push(c);
  codes.push(0x0b, 0x0c);
  for (let c = 0x0e; c <= 0x1f; c += 1) codes.push(c);
  codes.push(0x7f);
  return codes;
})();

const CONTROL_CHAR_SET = new Set(CONTROL_CHAR_CODE_POINTS);

function sanitizeExcerptText(text: string): string {
  let result = '';
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint !== undefined && CONTROL_CHAR_SET.has(codePoint)) {
      continue;
    }
    result += ch;
  }
  return result;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * adoptionReason の自由文から `A/B/C` 形式・単独識別子の要素名トークンを抽出し、
 * 「最後の区切り」（'/' の後ろ）を取り出す。トークンが見つからなければ空配列。
 */
function extractAnchorTokens(adoptionReason: string): readonly string[] {
  const matches = adoptionReason.match(/[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z][A-Za-z0-9]*)*/g);
  if (!matches) {
    return [];
  }
  return matches.map((token) => {
    const lastSlash = token.lastIndexOf('/');
    return lastSlash === -1 ? token : token.slice(lastSlash + 1);
  });
}

/**
 * 7.3: 原文抜粋を組み立てる純粋関数。
 * rawBody が null の場合は呼び出し側で excerpt を null にすること（本関数は呼ばない）。
 */
export function buildRawExcerpt(
  rawBody: string,
  adoptionReason: string | null,
): MonitoringRawExcerpt {
  const totalLength = rawBody.length;

  let anchor: 'head' | 'reason_match' = 'head';
  let matchIndex = -1;

  if (adoptionReason !== null) {
    for (const token of extractAnchorTokens(adoptionReason)) {
      const idx = rawBody.indexOf(token);
      if (idx !== -1) {
        matchIndex = idx;
        anchor = 'reason_match';
        break;
      }
    }
  }

  let startOffset = anchor === 'reason_match' ? Math.max(0, matchIndex - 500) : 0;
  // サロゲートペアの途中で切らない（下位サロゲートなら1文字戻す）
  if (startOffset > 0 && isLowSurrogate(rawBody.charCodeAt(startOffset))) {
    startOffset -= 1;
  }

  let endOffset = Math.min(totalLength, startOffset + EXCERPT_MAX_CHARS);
  if (endOffset < totalLength && isHighSurrogate(rawBody.charCodeAt(endOffset - 1))) {
    endOffset -= 1;
  }

  const rawSlice = rawBody.slice(startOffset, endOffset);
  const text = sanitizeExcerptText(rawSlice);
  const truncated = endOffset < totalLength;

  return {
    text,
    startOffset,
    totalLength,
    truncated,
    anchor,
  };
}
