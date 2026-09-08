export type TerminalMode = 'H' | 'K';
export type ViewId = 'weather' | 'warnings' | 'monitor' | 'training';
export interface Venue {
  id: string;
  name: string;
  municipality: string;
  amedas: string;
  experimental: boolean;
  mapReference: { latitude: number; longitude: number } | null;
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
    municipality: '江東区',
    amedas: '江戸川臨海',
    experimental: false,
    mapReference: null, // 座標の数値は地図実装時に確定する。
  },
  trc: {
    id: 'trc',
    name: '東京流通センター',
    municipality: '大田区',
    amedas: '羽田空港',
    experimental: true,
    mapReference: { latitude: 35.58, longitude: 139.75 },
  },
} satisfies Record<string, Venue>;
export const terminals: readonly Terminal[] = [
  { id: 'hkeagh01', name: '東地区外務H1', mode: 'H', venue: venues.east },
  { id: 'kkeagh01', name: '東地区外務K1', mode: 'K', venue: venues.east },
  { id: 'htrcph01', name: 'TRC公共H1', mode: 'H', venue: venues.trc },
  { id: 'ktrcph01', name: 'TRC公共K1', mode: 'K', venue: venues.trc },
];
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
