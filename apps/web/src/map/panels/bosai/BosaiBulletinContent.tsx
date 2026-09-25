import type { BulletinDto } from '@wx-viewer-poc/shared';

export interface BosaiBulletinContentProps {
  readonly bulletin: BulletinDto;
}

/** カードの中身は速報文全文のみ。区域・経過時間・目撃の有無は見出し文と重複するため出さない（§4.4）。 */
export function BosaiBulletinContent({ bulletin }: BosaiBulletinContentProps) {
  if (bulletin.headlineText === null) {
    return null;
  }

  return <div className="bosai-bulletin-headline">{bulletin.headlineText}</div>;
}
