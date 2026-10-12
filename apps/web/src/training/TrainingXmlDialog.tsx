import { useEffect, useRef } from 'react';
import { GbButton } from '../components/md';
import { nextDialogFocusTarget } from '../monitoring/monitoringDialogFocus';
import type { TrainingStockEntry } from './trainingStock';
import { formatTrainingJst } from './trainingFormat';

function dialogFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), md-gb-button:not([disabled])',
    ),
  ];
}

export interface TrainingXmlDialogProps {
  /** 開いている電文。一覧から押し出されても、閉じるまで同じ内容を保持する。 */
  readonly entry: TrainingStockEntry | null;
  readonly onClose: () => void;
}

/**
 * XML表示ダイアログ。開き方・閉じ方・フォーカスの戻り方は MonitoringDialogHost と同じ
 * （showModal、初期フォーカスは「閉じる」、Esc/閉じるで閉じて開く前の要素へ戻す、背景クリックでは閉じない）。
 */
export function TrainingXmlDialog({ entry, onClose }: TrainingXmlDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  const isOpen = entry !== null;

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
    if (isOpen) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => closeButtonRef.current?.focus());
      return;
    }
    if (dialog.open) dialog.close();
  }, [isOpen]);

  const telegram = entry?.telegram;
  return (
    <dialog
      ref={dialogRef}
      className="monitoring-dialog monitoring-dialog-wide training-dialog"
      aria-labelledby="training-dialog-title"
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
      {entry && telegram && (
        <>
          <h2 id="training-dialog-title" className="md-typescale-headline-small">
            {telegram.title}
          </h2>
          <div className="monitoring-dialog-body md-typescale-body-medium">
            <dl className="training-dialog-meta">
              <div>
                <dt className="training-badge">訓練用合成</dt>
                <dd>{telegram.areaNames.join('／')}</dd>
              </div>
              <div>
                <dt>発表</dt>
                <dd>{formatTrainingJst(telegram.reportDateTime)}</dd>
              </div>
              {telegram.validDateTime ? (
                <div>
                  <dt>失効</dt>
                  <dd>{formatTrainingJst(telegram.validDateTime)}</dd>
                </div>
              ) : null}
              <div>
                <dt>項目</dt>
                <dd>{entry.itemLabels.join('、')}</dd>
              </div>
            </dl>
            <pre className="training-xml" tabIndex={0}>
              {telegram.xml}
            </pre>
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
