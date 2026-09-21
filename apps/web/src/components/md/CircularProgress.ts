import React from 'react';

if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
  void import('@material/web/progress/circular-progress.js');
}

export interface CircularProgressProps extends React.HTMLAttributes<HTMLElement> {
  readonly indeterminate?: boolean;
  readonly value?: number;
  readonly max?: number;
  readonly 'aria-hidden'?: 'true' | 'false' | boolean;
}

/** md-circular-progress を登録し、React props として型安全に公開する (§9.4.8) */
export const CircularProgress = React.forwardRef<HTMLElement, CircularProgressProps>(
  function CircularProgress({ indeterminate, value, max, ...props }, ref) {
    return React.createElement('md-circular-progress', {
      ...props,
      indeterminate: indeterminate ? '' : undefined,
      value,
      max,
      ref,
    });
  },
);
