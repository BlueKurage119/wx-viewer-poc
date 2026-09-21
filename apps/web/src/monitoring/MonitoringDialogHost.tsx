import React, { useEffect, useRef, type ReactNode } from 'react';
import { GbButton } from '../components/md';
import { nextDialogFocusTarget } from './monitoringDialogFocus';
import type { MonitoringDialogId } from './monitoringToolbarState';

const dialogTitles: Record<MonitoringDialogId, string> = {
  reception: '受信履歴',
  telegram: '電文履歴',
  output: '出力履歴',
  diagnostics: '状態診断',
};

export interface MonitoringDialogContentContext {
  readonly dialogId: MonitoringDialogId;
  readonly close: () => void;
}
export interface MonitoringDialogHostProps {
  readonly dialogId: MonitoringDialogId | null;
  readonly onClose: () => void;
  readonly renderContent?: (context: MonitoringDialogContentContext) => ReactNode;
}

function dialogFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), md-gb-button:not([disabled])',
    ),
  ];
}

/** 後続の履歴・診断本文を差し込むための、モーダルの共通所有境界。 */
export function MonitoringDialogHost({
  dialogId,
  onClose,
  renderContent,
}: MonitoringDialogHostProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  const activeId = dialogId;
  const content = activeId ? renderContent?.({ dialogId: activeId, close: onClose }) : null;
  const hasDefaultContent = content === null || content === undefined;

  const restoreFocus = () => {
    const fallback = document.getElementById('view-content');
    const target = previousFocusRef.current?.isConnected ? previousFocusRef.current : fallback;
    target?.focus();
  };
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
    queueMicrotask(() => {
      restoreFocus();
      closingRef.current = false;
    });
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (activeId !== null) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => closeButtonRef.current?.focus());
      return;
    }
    if (dialog.open) dialog.close();
  }, [activeId]);

  return (
    <dialog
      ref={dialogRef}
      className="monitoring-dialog"
      aria-labelledby="monitoring-dialog-title"
      aria-describedby={hasDefaultContent ? 'monitoring-dialog-description' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => requestClose()}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const target = nextDialogFocusTarget(
          dialogFocusableElements(dialog),
          document.activeElement,
          event.shiftKey,
        );
        if (target === null) return;
        event.preventDefault();
        target.focus();
      }}
    >
      {activeId && (
        <>
          <h2 id="monitoring-dialog-title" className="md-typescale-headline-small">
            {dialogTitles[activeId]}
          </h2>
          <div className="monitoring-dialog-body md-typescale-body-medium">
            {hasDefaultContent ? (
              <p id="monitoring-dialog-description">表示内容は準備中です。</p>
            ) : (
              React.createElement('div', { key: activeId }, content)
            )}
          </div>
          <div className="monitoring-dialog-actions">
            <GbButton ref={closeButtonRef} color="text" size="sm" onClick={requestClose}>
              閉じる
            </GbButton>
          </div>
        </>
      )}
    </dialog>
  );
}
