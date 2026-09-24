/**
 * 状態入力から枠の表示形態を決める純粋関数 (G1 §5)。
 *
 * | status | always | occasional |
 * |---|---|---|
 * | loading | skeleton | hidden |
 * | failed | failed | hidden |
 * | empty | skeleton（always では渡さない想定） | hidden |
 * | data / available | content | content |
 * | data / stale | content（前回値、stale装飾なし） | content（前回値） |
 */
import type { InfoPanelDisplay, InfoPanelPresence, InfoPanelStatus } from './panelDefinitions';

export function resolveInfoPanelDisplay(
  presence: InfoPanelPresence,
  status: InfoPanelStatus,
): InfoPanelDisplay {
  if (presence === 'occasional') {
    if (status.kind === 'data') {
      return { mode: 'content', time: status.time, timeKind: status.timeKind };
    }
    // loading / failed / empty はすべて非表示（データがないときはカードを出さない）
    return { mode: 'hidden' };
  }

  // presence === 'always'
  switch (status.kind) {
    case 'loading':
      return { mode: 'skeleton' };
    case 'failed':
      return { mode: 'failed' };
    case 'empty':
      // always では渡さない想定。渡された場合は skeleton とする【設計案】。
      return { mode: 'skeleton' };
    case 'data':
      return { mode: 'content', time: status.time, timeKind: status.timeKind };
    default:
      return status satisfies never;
  }
}
