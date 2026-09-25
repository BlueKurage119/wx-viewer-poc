import type { BulletinDto } from '@wx-viewer-poc/shared';
import { formatBulletinElapsed, resolveBulletinAreaNames } from './bosaiBulletinCards';

export interface BosaiBulletinContentProps {
  readonly bulletin: BulletinDto;
  readonly nowMs: number;
}

export function BosaiBulletinContent({ bulletin, nowMs }: BosaiBulletinContentProps) {
  const areaNames = resolveBulletinAreaNames(bulletin);
  const elapsedText = formatBulletinElapsed(bulletin.reportDateTime, nowMs);

  return (
    <div className="bosai-bulletin-content">
      {areaNames.length > 0 && <div className="bosai-bulletin-areas">{areaNames.join('、')}</div>}
      <div className="bosai-bulletin-meta-row">
        <span className="bosai-bulletin-elapsed">{elapsedText}</span>
        {bulletin.hasSighting === true && (
          <span className="bosai-bulletin-sighting">目撃情報あり</span>
        )}
      </div>
      {bulletin.headlineText !== null && (
        <div className="bosai-bulletin-headline">{bulletin.headlineText}</div>
      )}
    </div>
  );
}
