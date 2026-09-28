/** 開発ビルドで専用フィクスチャが明示されたときだけ実通信を止める。 */
export function isEarlyWarningFixtureRequest(isDev: boolean, search: string): boolean {
  return isDev && new URLSearchParams(search).get('panelFixture') === 'early-warning';
}

export interface EarlyWarningFixtureEnvironment {
  readonly isDev: boolean;
  readonly search?: string;
}

export function isEarlyWarningFixtureActive(environment?: EarlyWarningFixtureEnvironment): boolean {
  const search = typeof window === 'undefined' ? '' : (window.location?.search ?? '');
  if (environment !== undefined)
    return isEarlyWarningFixtureRequest(environment.isDev, environment.search ?? search);
  return isEarlyWarningFixtureRequest(import.meta.env?.DEV === true, search);
}
