import React from 'react';

if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
  void import('@material/web/labs/gb/components/switch/md-gb-switch.js');
}

export interface GbSwitchProps {
  readonly selected: boolean;
  readonly onChange: (selected: boolean) => void;
  readonly id?: string;
  readonly 'aria-label'?: string;
}

interface SwitchElement extends HTMLElement {
  selected: boolean;
}

/**
 * M3 Expressive Labsスイッチ(`md-gb-switch`)を登録し、React propsとして型安全に公開する(§4.8)。
 *
 * React 19 でのカスタム要素への `selected` プロパティ反映・`change` イベント購読の実挙動は
 * 未確認のため(設計書§4.8)、JSX属性でのプロパティ橋渡しに依存せず、ref経由でDOMの
 * `selected` プロパティを直接設定し、ネイティブの `change` イベントを直接購読する
 * (設計書が示す製造裁量のフォールバック)。
 */
export const GbSwitch = React.forwardRef<HTMLElement, GbSwitchProps>(function GbSwitch(
  { selected, onChange, id, 'aria-label': ariaLabel },
  forwardedRef,
) {
  const localRef = React.useRef<SwitchElement | null>(null);

  React.useEffect(() => {
    const el = localRef.current;
    if (el) {
      el.selected = selected;
    }
  }, [selected]);

  React.useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const handleChange = () => {
      onChange(el.selected);
    };
    el.addEventListener('change', handleChange);
    return () => el.removeEventListener('change', handleChange);
  }, [onChange]);

  return React.createElement('md-gb-switch', {
    id,
    'aria-label': ariaLabel,
    ref: (node: SwitchElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.RefObject<HTMLElement | null>).current = node;
      }
    },
  } as React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>);
});
