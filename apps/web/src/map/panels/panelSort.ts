/**
 * occasional種別（速報等）のカードを発表・観測時刻の新しい順へ並べ替える。
 * 入力順（古い順・新しい順いずれ）に依存しない。
 */
import type { InfoPanelCardInput } from './panelDefinitions';
import { cardTimeValue } from './panelTime';

export function sortCardsByTimeDescending(
  cards: readonly InfoPanelCardInput[],
): readonly InfoPanelCardInput[] {
  return [...cards].sort((a, b) => cardTimeValue(b.status) - cardTimeValue(a.status));
}
