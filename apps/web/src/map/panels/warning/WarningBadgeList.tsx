/**
 * 警報・注意報バッジ群の描画 (G3 #54 §4.2)。
 *
 * 段階の container/on-container 色で塗り、全段階に 1px の outline 縁を付ける。
 * 色は補助であり、段階・種別・新規/強化/緩和はラベル文字で判別できるようにする。
 */
import type { WarningBadge } from './warningBadges';

const CHANGE_LABEL: Readonly<Record<'new' | 'strengthened' | 'weakened', string>> = {
  new: '新規',
  strengthened: '強化',
  weakened: '緩和',
};

export interface WarningBadgeListProps {
  readonly badges: readonly WarningBadge[];
}

export function WarningBadgeList({ badges }: WarningBadgeListProps) {
  return (
    <div className="warning-badge-list">
      {badges.map((badge) => (
        <span key={badge.code} className={`warning-badge-item warning-badge-item--${badge.stage}`}>
          {badge.label}
          {badge.change !== null && (
            <span className="warning-badge-item__change">{CHANGE_LABEL[badge.change]}</span>
          )}
        </span>
      ))}
    </div>
  );
}
