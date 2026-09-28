/**
 * 詳細ダイアログ共通コンポーネント (G10)。
 *
 * ネイティブ `<dialog>` の `showModal` で画面の約90%を使うモーダルを開く。
 * `document.body` 直下へ `createPortal` する（理由: 設計書 §3.1）。
 * 開閉・Escの扱い・フォーカス復帰は `apps/web/src/monitoring/MonitoringDialogHost.tsx` を踏襲する。
 */
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
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
  /**
   * 予報区・発表時刻の行の右端に置く操作(例: 警報等時系列の絞り込みスイッチ、§4.8)。
   * 未指定時はメタ行の出力を変更前と完全に同じにする(オプトイン、2026-09-28ユーザー許可)。
   */
  readonly metaAction?: ReactNode;
  /**
   * 開いたときの初期フォーカス先。未指定時は従来どおり見出し(h2)にフォーカスする
   * (オプトイン、2026-09-28ユーザー許可)。
   */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
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
  metaAction,
  initialFocusRef,
  children,
}: DetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closingRef = useRef(false);
  // dialog.close() を自ら呼んだ結果として発火するネイティブ close イベントかどうかの印。
  // requestClose の二重実行防止 (D7、PR #215差し戻し対応)。
  const programmaticCloseRef = useRef(false);
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
      // 初期フォーカスは閉じるボタンではなく見出しへ移す（D6・オーナーiPad実機確認）。
      // 閉じるボタンへ初期フォーカスするとタッチ操作でもフォーカスリングが出るため。
      // initialFocusRef指定時はそちらへ移す(§4.8、警報等時系列のスイッチなど。未指定時は従来どおり見出し)。
      queueMicrotask(() => {
        const target = initialFocusRef?.current ?? titleRef.current;
        target?.focus({ preventScroll: true });
      });
      return;
    }
    if (dialog.open) {
      programmaticCloseRef.current = true;
      dialog.close();
    }
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
      onClose={() => {
        // dialog.close() の結果として発火するネイティブ close イベント。
        // requestClose (閉じるボタン／Esc) とは別の閉鎖経路ではないため、ここでは再実行しない (D7)。
        if (programmaticCloseRef.current) {
          programmaticCloseRef.current = false;
          return;
        }
        // 想定外の経路（requestClose を経由しない閉鎖）へのフォールバック。
        requestClose();
      }}
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
              <h2 id={titleId} ref={titleRef} tabIndex={-1} className="md-typescale-headline-small">
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
            {metaAction === undefined ? (
              showMetaLine && (
                <p className="detail-dialog-meta md-typescale-body-medium">
                  {formatted.target}
                  {formatted.target !== null && formatted.time !== null ? ' · ' : ''}
                  {formatted.time}
                </p>
              )
            ) : (
              <div className="detail-dialog-meta-row">
                {showMetaLine && (
                  <p className="detail-dialog-meta md-typescale-body-medium">
                    {formatted.target}
                    {formatted.target !== null && formatted.time !== null ? ' · ' : ''}
                    {formatted.time}
                  </p>
                )}
                <div className="detail-dialog-meta-action">{metaAction}</div>
              </div>
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
