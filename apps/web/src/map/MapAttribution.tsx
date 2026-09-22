/**
 * 背景地図の常時出典リンク (F5 §6, §9.4)
 *
 * 国土地理院の地理院タイル一覧へのリンクを常時明示する。
 * 右列や時間カード、通知領域の下に隠れない位置に配置する。
 */
export function MapAttribution() {
  return (
    <div className="map-attribution">
      <a
        href="https://maps.gsi.go.jp/development/ichiran.html"
        target="_blank"
        rel="noreferrer"
        className="attribution-link"
      >
        地理院タイル
      </a>
      <a
        href="https://www.jma.go.jp/jma/index.html"
        target="_blank"
        rel="noreferrer"
        className="attribution-link"
      >
        気象庁
      </a>
    </div>
  );
}
