import React from 'react';

const gbButtonRegistration =
  typeof document !== 'undefined' && typeof document.createTreeWalker === 'function'
    ? import('@material/web/labs/gb/components/button/md-gb-button.js')
    : null;

export type GbButtonProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'aria-pressed' | 'color' | 'type'
> & {
  readonly color: 'filled' | 'elevated' | 'tonal' | 'outlined' | 'text';
  readonly size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  readonly square?: boolean;
  /** Labsの公開toggle契約。内部buttonのaria-pressedへ反映する。 */
  readonly toggle?: boolean;
  /** toggle時の選択状態。 */
  readonly selected?: boolean;
};

/** M3 Expressive Labsボタンを登録し、React propsとして型安全に公開する。 */
export const GbButton = React.forwardRef<HTMLElement, GbButtonProps>(function GbButton(
  { color, size, square = false, toggle = false, selected = false, ...props },
  ref,
) {
  const hostRef = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    let cancelled = false;
    void gbButtonRegistration?.then(() => {
      if (cancelled || hostRef.current === null) return;
      const button = hostRef.current as HTMLElement & { selected: boolean; type: string };
      button.type = toggle ? 'toggle' : 'button';
      button.selected = toggle && selected;
    });
    return () => {
      cancelled = true;
    };
  }, [selected, toggle]);
  return React.createElement('md-gb-button', {
    ...props,
    color,
    size,
    square,
    type: toggle ? 'toggle' : 'button',
    selected: toggle ? selected : undefined,
    ref: (element: HTMLElement | null) => {
      hostRef.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref !== null) ref.current = element;
    },
  } as React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>);
});
