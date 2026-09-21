import React from 'react';

if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
  void import('@material/web/labs/gb/components/button/md-gb-button.js');
}

export type GbButtonProps = Omit<React.ComponentPropsWithoutRef<'button'>, 'color'> & {
  readonly color: 'filled' | 'elevated' | 'tonal' | 'outlined' | 'text';
  readonly size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  readonly square?: boolean;
};

/** M3 Expressive Labsボタンを登録し、React propsとして型安全に公開する。 */
export const GbButton = React.forwardRef<HTMLElement, GbButtonProps>(function GbButton(
  { color, size, square = false, ...props },
  ref,
) {
  return React.createElement('md-gb-button', {
    ...props,
    color,
    size,
    square,
    ref,
  } as React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>);
});
