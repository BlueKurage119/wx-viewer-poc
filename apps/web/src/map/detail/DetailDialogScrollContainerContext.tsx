/**
 * 右側情報列スロット要素を、詳細ダイアログの入口（§6の仮入口、G4〜G6の本入口）へ配る Context (G10)。
 *
 * `WeatherMapView` が実測済みの列要素を Provider で渡し、各入口は `scrollContainer` として
 * `DetailDialog` へそのまま渡す。DOM構造を貫通させずに済ませるための取り回し（製造裁量）。
 */
import { createContext, useContext } from 'react';

const DetailDialogScrollContainerContext = createContext<HTMLElement | null>(null);

export const DetailDialogScrollContainerProvider = DetailDialogScrollContainerContext.Provider;

// eslint-disable-next-line react-refresh/only-export-components -- Providerと対になるhookのため同ファイルに置く（ThemeProvider.tsxと同じ方針）
export function useDetailDialogScrollContainer(): HTMLElement | null {
  return useContext(DetailDialogScrollContainerContext);
}
