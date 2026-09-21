export type GbButtonStateHost = HTMLElement & { selected: boolean; type: string };

/** React属性ではなく、Labsが公開するcustom elementのプロパティへ状態を同期する。 */
export function applyGbButtonState(
  button: GbButtonStateHost,
  toggle: boolean,
  selected: boolean,
): void {
  button.type = toggle ? 'toggle' : 'button';
  button.selected = toggle && selected;
}
