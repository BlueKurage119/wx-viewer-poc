/**
 * 右側情報パネルの共通枠 (G1)。
 *
 * 見出し（パネル名・対象名・時刻）と状態表示（スケルトン／取得失敗文言／前回値）を提供する。
 * `display.mode === 'hidden'` のときは何も描画しない。
 */
import type { ReactNode, WheelEvent } from 'react';
import type { InfoPanelDefinition, InfoPanelStatus } from './panelDefinitions';
import { resolveInfoPanelDisplay } from './panelDisplayState';
import { formatPanelTime } from './panelTime';

export interface InfoPanelFrameProps {
  readonly definition: InfoPanelDefinition;
  readonly heading?: string;
  readonly target?: string;
  readonly status: InfoPanelStatus;
  readonly children?: ReactNode;
}

function stopWheelPropagation(event: WheelEvent<HTMLElement>): void {
  // カード上のホイールを地図へ伝播させない（F1の挙動を維持、§4.2）
  event.stopPropagation();
}

export function InfoPanelFrame({
  definition,
  heading,
  target,
  status,
  children,
}: InfoPanelFrameProps) {
  const display = resolveInfoPanelDisplay(definition.presence, status);

  if (display.mode === 'hidden') {
    return null;
  }

  const headingText = heading ?? definition.title;
  const timeText =
    display.mode === 'content' ? formatPanelTime(display.time, display.timeKind) : undefined;

  return (
    <article
      className="info-panel-card"
      data-panel-id={definition.id}
      onWheel={stopWheelPropagation}
    >
      <header className="info-panel-card-heading">
        <span className="info-panel-card-title">{headingText}</span>
        {(target !== undefined || timeText !== undefined) && (
          <span className="info-panel-card-meta">
            {target}
            {target !== undefined && timeText !== undefined ? ' · ' : ''}
            {timeText}
          </span>
        )}
      </header>
      <div className="info-panel-card-body">
        {display.mode === 'skeleton' && (
          <div className="info-panel-card-skeleton" aria-hidden="true" />
        )}
        {display.mode === 'failed' && (
          <p className="info-panel-card-failed">取得できませんでした</p>
        )}
        {display.mode === 'content' && children}
      </div>
    </article>
  );
}
