/**
 * 詳細ダイアログ共通コンポーネント (G10)。
 *
 * ネイティブ `<dialog>` の `showModal` で画面の約90%を使うモーダルを開く。
 * `document.body` 直下へ `createPortal` する（理由: 設計書 §3.1）。
 * 開閉・Escの扱い・フォーカス復帰は `apps/web/src/monitoring/MonitoringDialogHost.tsx` を踏襲する。
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GbIconButton } from '../../components/md';
import { nextDialogFocusTarget } from '../../monitoring/monitoringDialogFocus';
import { DetailDialogIcon } from './DetailDialogIcon';
import { formatDetailDialogMeta, type DetailDialogMeta } from './detailDialogMeta';
import { useDetailDialogReturn } from './useDetailDialogReturn';

export interface DetailDialogProps {
  readonly open: boolean;
  readonly meta: DetailDialogMeta;
  readonly onClose: () => void;
  /** 閉じた後に右側列の scrollTop を戻す対象。省略時はスクロール復帰を行わない */
  readonly scrollContainer?: HTMLElement | null;
  readonly children?: ReactNode;
}

function dialogFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), md-gb-button:not([disabled]), md-gb-icon-button:not([disabled])',
    ),
  ];
}

/**
 * ダイアログ本体（ポータル抜き）。
 *
 * `renderToStaticMarkup` はサーバーレンダラで `createPortal` に未対応のため
 * （テスト環境の制約、設計書§2「テスト環境」）、実体をここへ切り出し、
 * 単体テストはこちらを直接描画する。実行時は `DetailDialog` が portal でラップする。
 */
export function DetailDialogInner({
  open,
  meta,
  onClose,
  scrollContainer,
  children,
}: DetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLElement>(null);
  const closingRef = useRef(false);
  const titleId = useId();
  const { save, restore } = useDetailDialogReturn(scrollContainer);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
    queueMicrotask(() => {
      restore();
      closingRef.current = false;
    });
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      save();
      if (!dialog.open) dialog.showModal();
      queueMicrotask(() => closeButtonRef.current?.focus({ preventScroll: true }));
      return;
    }
    if (dialog.open) dialog.close();
    // save/restore は scrollContainer が変わらない限り同一関数のため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const formatted = formatDetailDialogMeta(meta, new Date());
  const showMetaLine = formatted.target !== null || formatted.time !== null;

  return (
    <dialog
      ref={dialogRef}
      className="detail-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: 既存監視ダイアログと同じくデフォルトの即時クローズを止め、requestClose を通す (§4.2)
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
      {open && (
        <>
          <header className="detail-dialog-heading">
            <div className="detail-dialog-heading-row">
              <h2 id={titleId} className="md-typescale-headline-small">
                {meta.title}
              </h2>
              {formatted.trainingLabel !== null && (
                <span className="detail-dialog-training-label">{formatted.trainingLabel}</span>
              )}
              <GbIconButton
                color="standard"
                size="md"
                type="button"
                ref={closeButtonRef}
                aria-label="閉じる"
                title="閉じる"
                onClick={requestClose}
              >
                <DetailDialogIcon>close</DetailDialogIcon>
              </GbIconButton>
            </div>
            {showMetaLine && (
              <p className="detail-dialog-meta md-typescale-body-medium">
                {formatted.target}
                {formatted.target !== null && formatted.time !== null ? ' · ' : ''}
                {formatted.time}
              </p>
            )}
          </header>
          <div className="detail-dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/** 公開コンポーネント。`document.body` 直下へ `createPortal` する（理由: 設計書 §3.1）。 */
export function DetailDialog(props: DetailDialogProps) {
  return createPortal(<DetailDialogInner {...props} />, document.body);
}
