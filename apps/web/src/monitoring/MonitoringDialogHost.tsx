import React, { useEffect, useRef, type ReactNode } from 'react';
import { GbButton } from '../components/md';
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
