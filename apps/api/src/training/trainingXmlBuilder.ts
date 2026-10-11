/**
 * 訓練電文用の最小XML構築器。要素単位で組み立て、属性値・本文を必ずエスケープする。
 * DOCTYPE・外部実体・任意XML断片は受け付けない（文字列ではなく要素ツリーのみを入力とする）。
 */

export interface XmlNode {
  readonly name: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly children: readonly XmlNode[];
  readonly text: string | null;
}

export type XmlContent = XmlNode | string | null | undefined;

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 要素を作る。内容は文字列1つ（本文）か子要素の並び。null/undefinedは無視する。 */
export function el(
  name: string,
  attributes: Readonly<Record<string, string>> | null,
  ...content: readonly XmlContent[]
): XmlNode {
  const children: XmlNode[] = [];
  let text: string | null = null;
  for (const entry of content) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'string') {
      if (children.length > 0 || text !== null) throw new Error('本文と子要素は混在できません');
      text = entry;
    } else {
      if (text !== null) throw new Error('本文と子要素は混在できません');
      children.push(entry);
    }
  }
  return {
    name,
    attributes: attributes === null ? [] : Object.entries(attributes),
    children,
    text,
  };
}

function serializeNode(node: XmlNode, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  const attributes = node.attributes
    .map(([key, value]) => ` ${key}="${xmlEscape(value)}"`)
    .join('');
  if (node.children.length === 0) {
    if (node.text === null) lines.push(`${indent}<${node.name}${attributes}/>`);
    else lines.push(`${indent}<${node.name}${attributes}>${xmlEscape(node.text)}</${node.name}>`);
    return;
  }
  lines.push(`${indent}<${node.name}${attributes}>`);
  for (const child of node.children) serializeNode(child, depth + 1, lines);
  lines.push(`${indent}</${node.name}>`);
}

export function serializeXml(root: XmlNode): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  serializeNode(root, 0, lines);
  return `${lines.join('\n')}\n`;
}

const FULL_WIDTH_DIGITS = '０１２３４５６７８９';

/** 半角数字・小数点を全角にする（description・本文用）。 */
export function toFullWidth(value: string | number): string {
  return String(value).replace(/[0-9.]/g, (char) =>
    char === '.' ? '．' : FULL_WIDTH_DIGITS.charAt(Number(char)),
  );
}
