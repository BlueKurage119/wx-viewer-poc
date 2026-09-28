import { useEffect, useState } from 'react';

export interface FontLoadingStatus {
  readonly outlinedReady: boolean;
  readonly sharpReady: boolean;
}

/**
 * Material Symbols のフォント読み込み状態を監視するフック (Issue #58 §5.3, AC-18)。
 *
 * document.fonts.load() で読み込みを確認し、完了するまでリガチャ文字列の
 * 露出を防ぐため非表示(visibility: hidden)制御に使う。
 * タイムアウト(3秒)または失敗時は非表示のまま維持する。
 */
export function useFontLoading(): FontLoadingStatus {
  // FontFaceSet.check() は該当 @font-face が未登録でも true を返し得るため、
  // 初期値は未読込とし、対象文字を指定した load() の成功後だけ ready にする。
  const [status, setStatus] = useState<FontLoadingStatus>({
    outlinedReady: false,
    sharpReady: false,
  });

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) {
      return;
    }

    let isMounted = true;
    const timeoutId = setTimeout(() => {
      // 3秒タイムアウト: 完了していなければそのまま
    }, 3000);

    const checkOutlined = document.fonts
      .load('24px "Material Symbols Outlined"', 'navigation')
      .then((fonts) => fonts.length > 0)
      .catch(() => false);

    const checkSharp = document.fonts
      .load('24px "Material Symbols Sharp"', 'navigation')
      .then((fonts) => fonts.length > 0)
      .catch(() => false);

    Promise.all([checkOutlined, checkSharp]).then(([outlinedOk, sharpOk]) => {
      if (isMounted) {
        setStatus({
          outlinedReady: outlinedOk,
          sharpReady: sharpOk,
        });
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  return status;
}
