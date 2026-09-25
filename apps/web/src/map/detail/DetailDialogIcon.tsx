/**
 * 詳細ダイアログの閉じるボタン用アイコン表示 (G10 §3.3、UI監修反映)。
 *
 * `monitoring/MonitoringToolbar.tsx` の `Icon` と同じ方式（Material Symbols を
 * `aria-hidden="true"` の span で出す）を、`monitoring/` を変更・importせずに再実装する
 * （設計書§3.3「共通化は監視ダイアログ大改修時に行う」）。
 */
export function DetailDialogIcon({ children }: { readonly children: string }) {
  return (
    <span className="detail-dialog-close-icon" aria-hidden="true">
      {children}
    </span>
  );
}
