/**
 * 中断理由。ログにのみ使う。
 */
export type FetchAbortReason = 'shutdown' | 'stop';

/**
 * 取得ループ側が参照する読み取り専用の中断シグナル。
 */
export interface FetchAbortSignal {
  readonly aborted: boolean;
  readonly reason: FetchAbortReason | null;
}

class FetchAbortSignalImpl implements FetchAbortSignal {
  private _aborted = false;
  private _reason: FetchAbortReason | null = null;

  get aborted(): boolean {
    return this._aborted;
  }

  get reason(): FetchAbortReason | null {
    return this._reason;
  }

  /** @internal */
  _abort(reason: FetchAbortReason): void {
    if (this._aborted) {
      return;
    }
    this._aborted = true;
    this._reason = reason;
  }

  /** @internal */
  _reset(): void {
    this._aborted = false;
    this._reason = null;
  }
}

/**
 * 中断の指示側。標準の AbortController は使わない
 * （確定事項(1): HTTP 取得へは通さず、電文境界でのフラグ検査にのみ使う意図を型で表す）。
 */
export class FetchAbortController {
  private readonly _signal = new FetchAbortSignalImpl();

  get signal(): FetchAbortSignal {
    return this._signal;
  }

  /**
   * 冪等。既に中断済みなら理由を上書きしない。
   */
  abort(reason: FetchAbortReason): void {
    this._signal._abort(reason);
  }

  /**
   * 取得再開時に中断状態を解除する。
   */
  reset(): void {
    this._signal._reset();
  }
}
