import type { TimelineFrame, TimelineViewModel } from '../types';
import type { NowcastCatalog, NowcastFrame } from './nowcastCatalog';

/**
 * ISO 8601 UTC 文字列を JST の HH:mm 表記に変換する
 */
export function formatJstTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  // JST は UTC+9
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const hours = String(jstDate.getUTCHours()).padStart(2, '0');
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * ISO 8601 UTC 文字列を JST の MM/dd HH:mm 表記に変換する
 */
export function formatJstMonthDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstDate.getUTCDate()).padStart(2, '0');
  const hours = String(jstDate.getUTCHours()).padStart(2, '0');
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/**
 * 初期選択および「最新へ」で選択すべき代表コマを決定する (§9.1)
 * 1. 実況 (N1) の最新コマ
 * 2. 実況がない場合は、最も新しい実況に最も近い予測コマ (予測群の最も古いコマ)
 */
export function findLatestNowcastFrame(frames: readonly NowcastFrame[]): NowcastFrame | null {
  const representativeFrames = frames.filter((f) => f.representative);
  if (representativeFrames.length === 0) return null;

  const observedFrames = representativeFrames.filter((f) => f.kind === 'observed');
  if (observedFrames.length > 0) {
    return observedFrames[observedFrames.length - 1]!;
  }

  return representativeFrames[0]!;
}

/**
 * NowcastCatalog と選択・再生状態から TimelineViewModel を生成する純関数
 */
export function buildNowcastTimelineViewModel(params: {
  readonly catalog: NowcastCatalog;
  readonly selectedFrameId: string | null;
  readonly playing: boolean;
}): TimelineViewModel {
  const { catalog, selectedFrameId, playing } = params;

  // スライダー目盛りは representative: true のコマのみで構成
  const timelineFrames: TimelineFrame[] = catalog.frames
    .filter((f) => f.representative)
    .map((f) => ({
      id: f.id,
      displayTime: formatJstTime(f.validTime),
      kind: f.kind,
      enabled: true,
    }));

  const selectedFrame = catalog.frames.find((f) => f.id === selectedFrameId) ?? null;
  const latestFrame = findLatestNowcastFrame(catalog.frames);

  const selectedFrameLabel =
    selectedFrame !== null ? formatJstMonthDateTime(selectedFrame.validTime) : '';

  // 選択コマが最新代表コマと一致しているときは「最新へ」は非活性 (latestAvailable = false)
  const isAtLatest =
    latestFrame !== null && selectedFrame !== null && latestFrame.id === selectedFrame.id;
  const latestAvailable = latestFrame !== null && !isAtLatest;

  return {
    layerLabel: '雨雲ナウキャスト',
    selectedFrameId,
    selectedFrameLabel,
    selectedFrameKind: selectedFrame?.kind ?? null,
    frames: timelineFrames,
    playing,
    latestAvailable,
  };
}
