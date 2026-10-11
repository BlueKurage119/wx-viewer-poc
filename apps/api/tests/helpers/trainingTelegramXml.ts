import { DOMParser, type Element } from '@xmldom/xmldom';

export const NS_REPORT = 'http://xml.kishou.go.jp/jmaxml1/';
export const NS_HEAD = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const NS_BODY = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';
export const NS_EB = 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/';

export function parseXml(xml: string): Element {
  return new DOMParser({
    onError(_level, message) {
      throw new Error(message);
    },
  }).parseFromString(xml, 'text/xml').documentElement!;
}

/** 直下の子要素（localName一致）。 */
export function kids(parent: Element, localName?: string): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (
      node?.nodeType === 1 &&
      (localName === undefined || (node as Element).localName === localName)
    ) {
      result.push(node as Element);
    }
  }
  return result;
}

/** localNameの経路で辿り、末端の全要素を返す。 */
export function path(root: Element, ...names: string[]): Element[] {
  let current: Element[] = [root];
  for (const name of names) current = current.flatMap((node) => kids(node, name));
  return current;
}

export function text(element: Element | undefined): string {
  return (element?.textContent ?? '').trim();
}

export function textAt(root: Element, ...names: string[]): string {
  const found = path(root, ...names);
  if (found.length !== 1) throw new Error(`${names.join('/')} は1件のはずが ${found.length} 件`);
  return text(found[0]);
}

/** Intl による独立実装のJST表記（+09:00）。 */
export function jstString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`;
}
