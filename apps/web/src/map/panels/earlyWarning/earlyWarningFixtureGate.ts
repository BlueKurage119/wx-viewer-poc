/** 開発ビルドで専用フィクスチャが明示されたときだけ実通信を止める。 */
export function isEarlyWarningFixtureRequest(isDev: boolean, search: string): boolean {
  return isDev && new URLSearchParams(search).get('panelFixture') === 'early-warning';
}

export function isEarlyWarningFixtureActive(): boolean {
  return isEarlyWarningFixtureRequest(
    import.meta.env?.DEV === true,
    typeof window === 'undefined' ? '' : (window.location?.search ?? ''),
  );
}
