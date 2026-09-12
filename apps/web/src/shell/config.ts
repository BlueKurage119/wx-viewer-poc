import {
  TERMINAL_DEFINITIONS,
  resolveVenueForecastTargets,
  type TerminalMode,
  type VenueForecastTargets,
  type VenueId,
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
const venues = {
  east: {
    id: 'east',
    name: '東京ビッグサイト',
    experimental: false,
    weatherTargets: resolveVenueForecastTargets('east'),
  },
  trc: {
    id: 'trc',
    name: '東京流通センター',
    experimental: true,
    weatherTargets: resolveVenueForecastTargets('trc'),
  },
} satisfies Record<string, Venue>;
const terminalNames: Readonly<Record<string, string>> = {
  hkeagh01: '東地区外務H1',
  kkeagh01: '東地区外務K1',
  htrcph01: 'TRC公共H1',
  ktrcph01: 'TRC公共K1',
};
export const terminals: readonly Terminal[] = TERMINAL_DEFINITIONS.map((terminal) => ({
  id: terminal.id,
  name: terminalNames[terminal.id]!,
  mode: terminal.mode,
  venue: venues[terminal.venueId],
}));
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
export function resolveTerminal(path: string): Terminal | undefined {
  return terminals.find((terminal) => path === `/${terminal.id}` || path === `/${terminal.id}/`);
}
export function resolveView(hash: string, mode: TerminalMode): ViewId {
  return views.find((view) => `#${view.id}` === hash && view.modes.includes(mode))?.id ?? 'weather';
}
