import { useEffect, useRef, useState } from 'react';
import { listWarningMessagePreferenceOptions } from '@wx-viewer-poc/shared';
import { GbButton } from '../components/md';
import type { NotificationPreferences } from './notificationPreferences';

export function NotificationPreferencesDialog({
  preferences,
  onSave,
  onClose,
}: {
  readonly preferences: NotificationPreferences;
  readonly onSave: (preferences: NotificationPreferences) => boolean;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => [...preferences.autoConfirmMessageDefinitionIds]);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    firstRef.current?.focus();
    return () => {
      dialog?.close();
    };
  }, []);
  const options = listWarningMessagePreferenceOptions();
  return (
    <dialog
      ref={dialogRef}
      className="notification-preferences-dialog"
      aria-labelledby="notification-preferences-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.stopPropagation();
        if (event.key !== 'Tab') return;
        const elements = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'input, md-gb-button:not([disabled])',
          ) ?? []),
        ];
        const first = elements[0];
        const last = elements.at(-1);
        // カスタム要素の内部フォーカスもホストで判定する。
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h2 id="notification-preferences-title">通知設定</h2>
      <p>選択した警報は、受信から5秒後に自動確認します。</p>
      <div className="notification-preferences-options">
        {(['weather', 'system'] as const).map((origin) => (
          <fieldset key={origin}>
            <legend>{origin === 'weather' ? '気象' : 'システム'}</legend>
            {options
              .filter((option) => option.origin === origin)
              .map((option) => (
                <label key={option.id}>
                  <input
                    ref={option.id === options[0]?.id ? firstRef : undefined}
                    type="checkbox"
                    checked={draft.includes(option.id)}
                    onChange={(event) =>
                      setDraft((ids) =>
                        event.target.checked
                          ? [...ids, option.id]
                          : ids.filter((id) => id !== option.id),
                      )
                    }
                  />
                  <span>
                    {option.title}
                    {option.qualifier && <small>（{option.qualifier}）</small>}
                  </span>
                </label>
              ))}
          </fieldset>
        ))}
      </div>
      {error && (
        <p className="notification-preferences-error" role="alert">
          {error}
        </p>
      )}
      <div className="notification-preferences-actions">
        <GbButton color="filled" size="sm" square type="button" onClick={onClose}>
          取消
        </GbButton>
        <GbButton
          color="filled"
          size="sm"
          square
          type="button"
          onClick={() => {
            if (onSave({ schemaVersion: 1, autoConfirmMessageDefinitionIds: draft })) onClose();
            else setError('設定を保存できません。再試行してください。');
          }}
        >
          保存
        </GbButton>
      </div>
    </dialog>
  );
}
