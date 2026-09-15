import type { TimelineFrame } from './types';

/**
 * 指定方向で次に選択可能なコマを探す。
 * range の標準キー操作では無効コマで選択が止まるため、キーボード操作だけは飛び越える。
 */
export function findEnabledFrameIndex(
  frames: readonly TimelineFrame[],
  startIndex: number,
  direction: 1 | -1,
): number | null {
  for (
    let index = startIndex + direction;
    index >= 0 && index < frames.length;
    index += direction
  ) {
    if (frames[index]?.enabled) return index;
  }
  return null;
}
