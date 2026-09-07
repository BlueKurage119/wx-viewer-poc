import { FilledButton } from './components/md';
import { useThemeMode, type ColorModeSetting } from './theme';

const MODE_ORDER: ColorModeSetting[] = ['system', 'light', 'dark'];

function nextMode(current: ColorModeSetting): ColorModeSetting {
  const index = MODE_ORDER.indexOf(current);
  return MODE_ORDER[(index + 1) % MODE_ORDER.length]!;
}

export function App() {
  const { colorModeSetting, resolvedColorMode, setColorModeSetting } = useThemeMode();

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        alignItems: 'flex-start',
        padding: '32px',
      }}
    >
      <h1 className="md-typescale-headline-medium">防災気象情報表示サービス</h1>
      <p className="md-typescale-body-large">
        プロジェクト初期化雛形が起動しています。React・TypeScript・Vite・Material
        Web・MD3テーマの結線を確認するための画面です。
      </p>
      <p className="md-typescale-body-medium">
        現在のカラーモード設定: {colorModeSetting}（解決後: {resolvedColorMode}）
      </p>
      <FilledButton onClick={() => setColorModeSetting(nextMode(colorModeSetting))}>
        カラーモードを切り替える
      </FilledButton>
    </main>
  );
}
