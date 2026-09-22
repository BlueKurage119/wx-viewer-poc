import React from 'react';

if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
  void import('@material/web/labs/gb/components/iconbutton/md-gb-icon-button.js');
}

export type GbIconButtonProps = Omit<React.ComponentPropsWithoutRef<'button'>, 'color'> & {
  readonly color: 'filled' | 'tonal' | 'outlined' | 'standard';
  readonly size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  readonly square?: boolean;
};

/** M3 Expressive Labsアイコンボタンを登録し、React propsとして型安全に公開する。 */
export const GbIconButton = React.forwardRef<HTMLElement, GbIconButtonProps>(function GbIconButton(
  { color, size, square = false, ...props },
  ref,
) {
  return React.createElement('md-gb-icon-button', {
    ...props,
    color,
    size,
    square,
    ref,
  } as React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>);
});
