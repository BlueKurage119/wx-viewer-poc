import {
  TERMINAL_DEFINITIONS,
  type TerminalMode,
  type VenueForecastTargets,
  type VenueId,
  type VenueRegistry,
} from '@wx-viewer-poc/shared';

export type { TerminalMode } from '@wx-viewer-poc/shared';
export type ViewId = 'weather' | 'warnings' | 'monitor' | 'training';
export interface Venue {
  id: VenueId;
  name: string;
  experimental: boolean;
  weatherTargets: VenueForecastTargets;
}
export interface Terminal {
  id: string;
  name: string;
  mode: TerminalMode;
  venue: Venue;
}
const terminalNames: Readonly<Record<string, string>> = {
  hkeagh01: '東地区外務H1',
  kkeagh01: '東地区外務K1',
  htrcph01: 'TRC公共H1',
  ktrcph01: 'TRC公共K1',
};
export function createTerminals(registry: VenueRegistry): readonly Terminal[] {
  const venues = new Map<VenueId, Venue>();
  return Object.freeze(
    TERMINAL_DEFINITIONS.map((terminal) => {
      const venueId = registry.resolveVenueId(terminal.venueId);
      if (!venueId) {
        throw new Error(`端末台帳の会場 ID が設定にありません: ${terminal.venueId}`);
      }
      const targets = registry.getVenue(venueId);
      let venue = venues.get(venueId);
      if (!venue) {
        venue = Object.freeze({
          id: venueId,
          name: targets.venueName,
          experimental: targets.experimental,
          weatherTargets: targets,
        });
        venues.set(venueId, venue);
      }
      return Object.freeze({
        id: terminal.id,
        name: terminalNames[terminal.id]!,
        mode: terminal.mode,
        venue,
      });
    }),
  );
}
export const views: readonly {
  id: ViewId;
  /** ナビレール表示用。4文字以内とする。 */
  label: string;
  /** ヘッダーの画面タイトル用。省略しないフル名称。 */
  title: string;
  icon: 'weather' | 'warnings' | 'monitor' | 'training';
  modes: readonly TerminalMode[];
}[] = [
  { id: 'weather', label: '気象情報', title: '防災気象情報', icon: 'weather', modes: ['H', 'K'] },
  { id: 'warnings', label: '警報一覧', title: '警報一覧', icon: 'warnings', modes: ['H', 'K'] },
  {
    id: 'monitor',
    label: '取得監視',
    title: '気象通報取得監視',
    icon: 'monitor',
    modes: ['K'],
  },
  {
    id: 'training',
    label: '訓練通知',
    title: '訓練通知',
    icon: 'training',
    modes: ['K'],
  },
];
export function resolveTerminal(
  path: string,
  terminals: readonly Terminal[],
): Terminal | undefined {
  return terminals.find((terminal) => path === `/${terminal.id}` || path === `/${terminal.id}/`);
}
