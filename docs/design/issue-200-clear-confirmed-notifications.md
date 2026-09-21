# Issue #200 全件確認後の下部通知領域の空欄化

対象Issue: #200。設計承認待ち。実装予定ブランチ: `codex/issue-200-clear-confirmed-notifications`。

## 1. 目的・確定事項

【確定・Issue本文承認済み】各通知行には未確認通知だけを表示する。最後の通知を確認すると通知なしの表示へ戻し、確認済み最新通知への戻りをなくす。警報行と問いかけ／非常行は独立し、各行内では既存の新しい順を維持する。

通知データと確認済み状態はメモリ内に保持する。同一`feedKey`の再受信では再表示せず、新しい`feedKey`は未確認として表示する。問いかけ／非常は「確認」の選択では完了せず、「送信」で確認済みにする。未読・未対応件数、鳴動対象切替、H/Kフィルタを維持する。

API・DB・通知生成規則・サーバー履歴削除、永続化・端末間共有、スヌーズ、履歴UI新設は対象外。並行作業中の既存コードには触れず、設計承認後の製造は専用Worktreeへ分離する。

## 2. 根拠資料と現状

- [Issue #200](https://github.com/BlueKurage119/wx-viewer-poc/issues/200): 上記の表示仕様と受け入れ条件の根拠。
- [H2設計](issue-64-notification-area.md) §3.2・§4.1: store保持と空欄時の非活性ボタン2枠を再利用する。§4.1の「全件確認後は最新通知を表示する」は本件で置き換える旧仕様。
- [H1設計](issue-63-header-flashing-buzzer.md) §4: 既に有効化された確認・選択後送信、ヘッダー停止と通知確認の分離を維持する。
- [notificationStore.ts](../../apps/web/src/notifications/notificationStore.ts): `displayedNoticeForRow`が未確認を検索した後に`notices[0]`へfallbackすることが原因。`confirmNotification`は確認済みキーを登録し、通知本体を削除しない。
- [NotificationArea.tsx](../../apps/web/src/shell/NotificationArea.tsx): `notice`が`undefined`なら本文は空、選択肢は非表示、文字のない非活性ボタン2枠になる。コンポーネントやCSSの変更は不要。
- [既存storeテスト](../../apps/web/tests/notificationStore.test.ts)・[既存shellテスト](../../apps/web/tests/shell.test.ts): 次の未確認への切替、選択後送信、初期空欄は検証済みのテストがあるが、全件確認後の空欄は不足。
- [App.tsx](../../apps/web/src/App.tsx)・[fixtures.ts](../../apps/web/src/shell/fixtures.ts): 開発用`?shellPreview=1`で通知取得を無効化し、既存サンプルと実際の確認操作を使用できる。

参照コード基点: `7c5dc66`。開始時の既存差分は`config/polling.yaml`のみであり、変更しない。

## 3. 変更設計

### 3.1 表示選択

既存シグネチャを維持する。

```typescript
displayedNoticeForRow(
  state: NotificationUiState,
  mode: TerminalMode,
  row: 'warning' | 'question',
): NotificationFeedItem | undefined
```

`noticesForRow(state, mode, row)`が返す既存順序の通知から、`confirmedFeedKeys`に含まれない最初の1件だけを返す。該当なしは`undefined`とし、最新通知へのfallbackを削除する。関数コメントも未確認のみを表示する契約に合わせる。

`noticesForRow`は確認済みを含む行の全保持通知を返す関数のままにする。並び順は`occurredAt`降順、同時刻は既存の`sequence`比較、さらに同順の場合は`feedKey`降順を維持する。問いかけと非常は同じ行に属し、表示順を鳴動の区分優先度に変更しない。

`NotificationUiState`、`receiveNotifications`、`confirmNotification`、`selectQuestionConfirmation`、`notificationCounts`、`nextUnconfirmedChime`の型・シグネチャ・状態更新規則は変更しない。APIエンドポイントの追加・変更はない。

### 3.2 空欄と確認操作

空欄では既存の`NoticeRow`分岐をそのまま使う。本文と選択肢は表示せず、文字のない非活性ボタン2枠を残す。行自体、操作ガイド行、未読・未対応の表示は維持する。説明文、確認完了ラベル、別の履歴導線は追加しない。

警報は「確認」で対象キーだけを確認済みにする。問いかけ／非常は「確認」を選択した後の「送信」で対象キーを確認済みにし、選択状態を解除する。更新後のReact描画で次の未確認または空欄へ移る。新たな遅延・タイマー・通信待ちは設けない。空欄へ移った後は有効な確認操作がなく、再確認できない。

### 3.3 変更ファイルとH2設計整合

| ファイル | 変更内容 |
| --- | --- |
| `apps/web/src/notifications/notificationStore.ts` | 表示fallback削除とコメント修正 |
| `apps/web/tests/notificationStore.test.ts` | 最終確認、順送り、保持・再受信・新着・件数・フィルタの回帰テスト |
| `apps/web/tests/shell.test.ts` | 確認後の空欄、非活性ボタン枠、選択後送信の描画検証 |
| `docs/design/issue-64-notification-area.md` | §4.1の全件確認後表示を本仕様へ更新し、§7受け入れ条件に全件確認後の空欄を追記。Issue #200による仕様改訂であることを明記 |
| `docs/design/issue-200-clear-confirmed-notifications.md` | 本設計の資産化 |

H2の過去フェーズにおける操作非活性・将来接続の記述は、H1での有効化に先行する履歴である。本件ではH2 §4.1に、確認操作の現行仕様はH1設計と本設計を参照する旨を添え、過去設計全体の書き直しはしない。

`NotificationArea.tsx`、`App.tsx`、CSS、fixture、API、shared、設定・依存関係は変更しない。検証で追加変更の必要性が判明した場合は統括へ戻す。

## 4. 受け入れ条件・検証方法

- [ ] AC1: warning・question・emergency各1件を個別に受信し、対象の確認処理後に該当行の`displayedNoticeForRow`が厳密に`undefined`になる。question・emergencyでは選択のみの中間状態で元のキーが表示され、確認済み集合に入っていないことも検証する。
- [ ] AC2: 警報2件、および問いかけ・非常混在の2件を異なる発生時刻で受信する。それぞれ「新→旧→undefined」の順に表示されることを完全一致で検証する。混在行では区分優先にせず時刻順となるケースを使う。
- [ ] AC3: 警報行と問いかけ／非常行の両方を受信し、一方だけ全件確認する。他方の表示キーと未確認状態が保持されることを検証する。両方向を確認する。
- [ ] AC4: 全件確認後も`items`の通知内容および確認済みキー集合が保持されることを完全一致で検証する。同一キーを再受信しても表示は`undefined`、件数は0、鳴動要求は`null`のままである。新しいキーを追加するとそのキーが表示され、既存キーの確認状態が保たれる。warning・question・emergencyそれぞれを対象とする。
- [ ] AC5: 表示中通知は既読、後続未表示通知は未読、次を表示すると既読になることを検証する。`ackRequired`がtrue/falseの通知を含め、全件確認後の件数が`{ unread: 0, pending: 0 }`となる。残る未確認通知への鳴動対象切替、全件確認後の`null`も完全一致で検証する。
- [ ] AC6: system・weather両originを含む状態でH/Kの表示、件数、鳴動対象を検証する。Hではsystemが非表示でもデータを保持し、weatherを全件確認すれば行は空欄になる。Kでは未確認systemが引き続き対象である。
- [ ] AC7: 実際の確認関数で全件確認した状態を、コールバックありの`NotificationArea`へ渡してSSRする。両通知行の本文が空、選択肢なし、文字のないdisabledボタンが合計4枠であることを検証する。操作ガイド・件数表示が残り、空欄に通知本文用の`tabIndex=0`が付かないことも確認する。HTML全体の空状態との完全一致、または対象要素の値の完全一致を基本とする。
- [ ] AC8: 専用Worktreeの開発サーバーを既存サーバーとは異なる空きポートで起動し、`?shellPreview=1`の「長文」で警報の最後の1件を確認する。本文が消え、既存の空欄2枠が非活性になり、行の高さ・ボタン配置が初期空欄と同じであることをブラウザで確認する。
- [ ] AC9: 同プレビューの「複数区分」で問いかけ／非常の各通知を「確認」→「送信」で処理する。「確認」のみでは本文が残り送信が有効、送信後は次の未確認へ進み、最後は空欄になることを確認する。一方の行だけ処理して他方の通知が残ること、両行完了後に件数が0となることも確認する。必要に応じ同じシナリオを再選択して通知を初期化する。シナリオ再選択はstoreを初期化するため、同一キー再受信の検証には使わない。
- [ ] AC10: 鳴動中の対象を確認したときは残る未確認の対象へ移り、全件確認で停止する。ヘッダーで停止済みの場合は確認により鳴動を再開しない。プレビューの複数区分でブラウザ確認し、音声の自動再生制限がある場合は明示操作後に再確認する。
- [ ] AC11: `npm run lint`、`npm run typecheck`、`npm run format:check`、`npm run test -w apps/web`が通過する。新規テストについては業務標準に従い、意味を変えないコメント改変の対照実験後、旧fallbackを復元すると空欄期待の回帰テストが実際に失敗することを記録し、改変を戻した最終状態で成功を確認する。
- [ ] AC12: H2設計§4.1の旧fallback方針が本設計と一致し、§7の受け入れ条件にも反映されている。差分が本設計の変更ファイル内に収まり、並行作業のファイル・サーバーへ干渉していない。

## 5. 未確認事項・後続への引き継ぎ

**実挙動未確認**: 本設計フェーズではブラウザ操作、鳴動、空欄の視覚・フォーカス挙動、Worktree上の依存関係と検証ポートを確認していない。コードの読み取りで設計し、製造・検収でAC8〜AC11を実行する。専用Worktree作成、ブランチ作成、コード変更、サーバー操作は行っていない。

要ヒアリング事項はない。実装方式の選定と製造着手は統括が設計承認を受けてから行う。

確認状態のreload後保持・端末間共有は本件で扱わずH4 #66の領域とする。スヌーズはH3 #65の領域であり、本件で仕様を確定しない。履歴UI・サーバー受領監視は新設しない。本件による追加の後続Issue起票事項はない。

作成: Codex (GPT-6)。
