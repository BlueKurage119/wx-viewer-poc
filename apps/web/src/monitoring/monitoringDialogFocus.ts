/** dialog内の先頭・末尾でTab移動を循環させる。 */
export function nextDialogFocusTarget(
  focusable: readonly HTMLElement[],
  activeElement: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return null;
  if (activeElement === null || !focusable.includes(activeElement as HTMLElement)) {
    return shiftKey ? last : first;
  }
  if (shiftKey && activeElement === first) return last;
  if (!shiftKey && activeElement === last) return first;
  return null;
}
