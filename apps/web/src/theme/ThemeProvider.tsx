import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { applyMd3Theme } from './applyTheme';
import { DEFAULT_THEME_SEED } from './seeds';

export type ColorModeSetting = 'light' | 'dark' | 'system';
export type ResolvedColorMode = 'light' | 'dark';

export const COLOR_MODE_STORAGE_KEY = 'wx-viewer:color-mode';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function readStoredColorMode(): ColorModeSetting {
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // storage読み書き失敗時はsystemへフォールバックする
  }
  return 'system';
}

function writeStoredColorMode(setting: ColorModeSetting): void {
  try {
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, setting);
  } catch {
    // storageへ書き込めなくても画面は停止させない
  }
}

function resolveColorMode(setting: ColorModeSetting): ResolvedColorMode {
  if (setting === 'system') {
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
  }
  return setting;
}

interface ThemeContextValue {
  colorModeSetting: ColorModeSetting;
  resolvedColorMode: ResolvedColorMode;
  setColorModeSetting: (setting: ColorModeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorModeSetting, setColorModeSettingState] =
    useState<ColorModeSetting>(readStoredColorMode);
  const [resolvedColorMode, setResolvedColorMode] = useState<ResolvedColorMode>(() =>
    resolveColorMode(colorModeSetting),
  );

  const setColorModeSetting = useCallback((setting: ColorModeSetting) => {
    writeStoredColorMode(setting);
    setColorModeSettingState(setting);
  }, []);

  // OS設定の変更を購読し、systemモードのときだけ追従する
  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
    const handleChange = (): void => {
      setResolvedColorMode(resolveColorMode(colorModeSetting));
    };
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [colorModeSetting]);

  // 解決後のモードが変わったときにテーマを適用する
  useLayoutEffect(() => {
    applyMd3Theme(DEFAULT_THEME_SEED, resolvedColorMode === 'dark');
  }, [resolvedColorMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ colorModeSetting, resolvedColorMode, setColorModeSetting }),
    [colorModeSetting, resolvedColorMode, setColorModeSetting],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- ThemeProviderと対になるhookのため同ファイルに置く
export function useThemeMode(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within a ThemeProvider');
  }
  return context;
}
