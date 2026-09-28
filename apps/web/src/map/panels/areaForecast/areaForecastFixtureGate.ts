/** 開発ビルドで専用フィクスチャが明示されたときだけ実通信を止める (Issue #58 §6)。 */
export function isAreaForecastFixtureRequest(isDev: boolean, search: string): boolean {
  return isDev && new URLSearchParams(search).get('panelFixture') === 'area-forecast';
}

export interface AreaForecastFixtureEnvironment {
  readonly isDev: boolean;
  readonly search?: string;
}

export function isAreaForecastFixtureActive(environment?: AreaForecastFixtureEnvironment): boolean {
  const search = typeof window === 'undefined' ? '' : (window.location?.search ?? '');
  if (environment !== undefined) {
    return isAreaForecastFixtureRequest(environment.isDev, environment.search ?? search);
  }
  return isAreaForecastFixtureRequest(import.meta.env?.DEV === true, search);
}
