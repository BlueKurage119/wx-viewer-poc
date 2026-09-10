# Issue #118「C8-1. 外部サンプル依存を解消し fixture を自己完結化する」設計

作成日: 2026-09-11

## 1. 目的

`apps/api` のJMA XML parser／processorテストが開発者端末固有の絶対パスに依存している状態を解消する。テストで使う公式サンプルXMLをリポジトリ内のfixtureとして管理し、clone直後・CI・外部資料を持たない環境でも同じ入力で実行できるようにする。

本Issueはテスト入力とその来歴記録だけを扱う。実行時コード、XML parser／processorの仕様、テストの期待値・テストケースの意味、外部からの電文取得機能は変更しない。

## 2. 参照資料と判断根拠

- GitHub Issue #118「C8-1. 外部サンプル依存を解消し fixture を自己完結化する」
- [`../data-acquisition-report.md`](../data-acquisition-report.md) §3.2、§10 [L10]、特に既存VPBS50負例の取得元記録（同ファイル L137、L392）
- [気象庁ホームページの利用規約](https://www.jma.go.jp/jma/kishou/info/coment.html)（2026-09-11確認）
- [気象情報の高度利用者向けホームページ ご利用上の留意事項](https://www.data.jma.go.jp/developer/ryuui.pdf)（2026-09-11確認）
- 既存テスト8ファイルと `apps/api/tests/fixtures/20260905220832_0_VPBS50_130000.xml`

調査時点で外部絶対パスを持つのは次の8ファイルである。

1. `jmaVpfd51Parser.test.ts`
2. `jmaVpfd51Processor.test.ts`
3. `jmaVpwp50Parser.test.ts`
4. `jmaEarlyWarningParser.test.ts`
5. `jmaVpbs50Parser.test.ts`
6. `jmaVpbs50Processor.test.ts`
7. `jmaVphwParser.test.ts`
8. `jmaVphwProcessor.test.ts`

これらが読む外部サンプルは重複を除き18件である。気象庁の利用規約は、権利表記のないコンテンツを公共データ利用規約第1.0版に準じて利用可能とし、出典表示を求める。編集・加工する場合は加工した旨を別途表示し、気象庁作成であるかのように表示してはならない。高度利用者向けの留意事項も、個別法令に反しない範囲で二次利用を原則制限せず、出典および加工・編集責任の明記を求める。

したがって、原文をバイト列のまま収録するfixtureは出典URL・原文SHA-256を、コメント追加などを含む加工fixtureは加工内容・原文SHA-256・fixture SHA-256を記録して再配布する。テスト用に閉じた静的データであり、予報値・対象区域を変更して第三者に継続提供するものではない。ただし、将来fixtureを加工する際も警報等の本質を損なう変更や、実データを気象庁作成と誤認させる表記をしてはならない。

## 3. 設計方針

### 3.1 配置と命名

JMA由来XMLは `apps/api/tests/fixtures/jma/` に集約する。ファイル名は出典サンプルの名前を変更せず、そのまま `.xml` を含めて保持する。テスト名・期待値が参照している電文種別、系列、発表時刻との対応を失わず、出典との照合もできるためである。

```text
apps/api/tests/fixtures/
├── jma/
│   ├── 19_01_01_091210_VPHW50.xml
│   ├── ...（公式サンプル原文18件）
│   ├── 20260905220832_0_VPBS50_130000.xml
│   └── manifest.json
└── （JMA由来でない将来fixtureはここへ混在させない）
```

既存の `20260905220832_0_VPBS50_130000.xml` も同じディレクトリへ移動し、マニフェストに記録する。現在のファイルは先頭に説明コメントを加えているため「加工物」と分類する。今回追加する18件は取得済み公式サンプルをバイト列のままコピーし「原文」と分類する。XMLの整形、改行コード変換、コメント追加・削除、文字コード変換は行わない。

テスト側は各ファイルに `apiRoot` から導く `jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma')` を一度だけ定義し、既存の `samplesDir` と絶対パスを置換する。外部資料の有無によってテストを黙ってskipする `existsSync` 分岐は削除し、fixtureの存在を `assert.ok(existsSync(...))` で必須条件として検査する。これはfixtureの欠落を成功扱いにしないためである。

### 3.2 来歴マニフェスト

`apps/api/tests/fixtures/jma/manifest.json` を人間がレビュー可能な単一の来歴台帳とする。テスト実行時に読み込むAPIではない。少なくとも次のJSON構造を用いる。

```json
{
  "schemaVersion": 1,
  "license": {
    "name": "公共データ利用規約（第1.0版）に準拠",
    "termsUrl": "https://www.jma.go.jp/jma/kishou/info/coment.html",
    "attribution": "出典：気象庁ホームページ（<sourceUrl>）"
  },
  "fixtures": [
    {
      "path": "19_01_01_091210_VPHW50.xml",
      "kind": "original",
      "sourceUrl": "<公式サンプルを取得したURL>",
      "sourceFileName": "19_01_01_091210_VPHW50.xml",
      "sourceSha256": "<取得直後の原文SHA-256（64桁小文字hex）>",
      "fixtureSha256": "<リポジトリ内ファイルのSHA-256>",
      "retrievedAt": "<ISO 8601日時>",
      "purpose": "VPHW50の正例・processor統合"
    },
    {
      "path": "20260905220832_0_VPBS50_130000.xml",
      "kind": "derived",
      "sourceUrl": "https://www.data.jma.go.jp/developer/xml/data/20260905220832_0_VPBS50_130000.xml",
      "sourceSha256": "<取得直後の原文SHA-256>",
      "fixtureSha256": "<コメント追加後のfixture SHA-256>",
      "transform": "先頭に来歴・用途を示すXMLコメントを追加。電文要素・属性・本文は変更しない。",
      "editor": "リポジトリ管理者",
      "retrievedAt": "2026-09-10T21:51:29+09:00",
      "purpose": "伊豆諸島南部を対象とするVPBS50の会場判定負例"
    }
  ]
}
```

`kind` は `original` または `derived` のみとし、`original` は `sourceSha256` と `fixtureSha256` が完全一致すること、`derived` は `transform`・`editor` を必須とする。ハッシュは対象ファイルの生バイト列に対するSHA-256であり、文字列として再エンコードして算出しない。全fixtureに出典URL・取得時刻・用途を持たせる。ファイル追加・置換・加工時には同一変更でマニフェストも更新する。

製造時は、追加する18件についてコピー元とコピー先に `shasum -a 256` を実行し、同じハッシュであることを確認して値をマニフェストへ固定する。既存VPBS50負例は、公式URLから取得した原文を改めてハッシュ化して `sourceSha256` を記録し、現存fixtureの `fixtureSha256`（調査時点: `05710ff68c81edca54f4b000830130ff4ed32dec1746a7a0ddd1bde71507ceec`）との差異を `transform` と整合させる。公式URLが取得不能なら原文ハッシュを推測して記録せず、製造を停止して統括へ報告する。

### 3.3 収録対象

次の18件を `original` として収録する。括弧内は調査時の外部原文SHA-256であり、製造時にコピー元・収録先の双方で再検証してマニフェストへ記載する。

| 電文 | fixture | SHA-256 |
| --- | --- | --- |
| VPFD51 | `24_11_03_190925_VPFD51.xml` | `69d229716bd21c8311b57da8a3fbee83a5dcf707adeb4943913d02fd4f6cfc2d` |
| VPWP50 | `81_01_01_260129_VPWP50.xml` | `bd6239228b4ad8a61a4eb58cf521a3c2be386507b79c9c6916b716cc9ecdb5ba` |
| VPFD61 | `90_01_01_241031_VPFD61.xml` | `fa943a25c27112532dcd1a0f17e2ae39d166d79e5df7e717560541e6c7a99d09` |
| VPFW60 | `69_01_01_241031_VPFW60.xml` | `02d24355d9ce09276e9aa8f1d91f78396516cb7ce862f645243424ff5f661ab8` |
| VPBS50 | `82_01_01_260324_VPBS50.xml` | `c753f19c83da98ac154bf952b85976df12864e3f6d636da1308899380c459748` |
| VPBS50 | `82_01_02_250630_VPBS50.xml` | `b1a1b183d1a55af0a8419d40928bf1d06800e794f25943de1e81d1e0b33772b3` |
| VPBS50 | `82_01_03_241031_VPBS50.xml` | `a50825ee858ab9fb36e5d152808ac54caa3b742040c71c0f388c9a2d9fe0c5f3` |
| VPBS50 | `82_03_01_260324_VPBS50.xml` | `4298694620bf3a3ebed8cd64fe166b9d6fea0772a0671a1c8fac40d72f079c2e` |
| VPBS50 | `82_03_02_260324_VPBS50.xml` | `1f7f0068c73adc554336942f391c3301e9c930d02b51a8ec5b87a3a373001b2d` |
| VPBS50 | `82_03_03_260324_VPBS50.xml` | `79d7af2605c456fb734985e5b0bf29a4e3411eef6ec46b4bddcb2a5dc32a14bd` |
| VPHW50 | `19_01_01_091210_VPHW50.xml` | `a9fabc8d1bd56dd5d340b5865ec1c4bbd22ca98f9ad9a52bcc1c16d5007b18ca` |
| VPHW51 | `19_04_01_140425_VPHW51.xml` | `788716174dc659530f941b886f15bb1b7f9f6f7c67e85e802a438c7a66be27ea` |
| VPHW51 | `19_05_01_140425_VPHW51.xml` | `82f4b51ba889177b346c43d80f97afe66e78f8460162b6e0e107f61124c0e3f4` |
| VPHW50 | `19_10_03_250630_VPHW50.xml` | `aa549141f9ccb8bcc30dd51daeb1e51c2f7dd41cecaa05c70cc98a6f32523e46` |
| VPHW50 | `19_08_03_250630_VPHW50.xml` | `cfed836bdda2e8eb2baf09f8d8974ebda31447dd74cc1ecd3acc53b0c45202e9` |
| VPHW50 | `19_10_01_150916_VPHW50.xml` | `5bb9afb2f6052bad35b11e5766a5e05f6ff02b2b27553d5bdd732d62a89c2407` |
| VPHW51 | `19_10_02_150916_VPHW51.xml` | `d976d9f860e1a92e4a097d11497ceda3550928337fd7b359f22d6338c050b58e` |
| VPHW50 | `19_08_01_150916_VPHW50.xml` | `5040415fc4478108220089992a12dd1eace8840ddc14d3baf244ef8a3499d9f7` |

各entryの `sourceUrl` は、元資料の公式サンプル配布URLを実際に確認して記載する。親ディレクトリのローカルパスはマニフェスト、テスト、README、コメントに記録しない。これは自己完結性を測る対象でもある。

### 3.4 テスト更新方針

- 8ファイルのfixture参照だけを変更する。parser／processor実装、テストの期待オブジェクト、DB準備、テスト名の意味は変えない。
- `jmaVpfd51Parser.test.ts` と `jmaVpfd51Processor.test.ts` は同じVPFD51 fixtureを参照する。
- `jmaVpbs50Parser.test.ts` と `jmaVpbs50Processor.test.ts` は既存負例を含め、すべて同じJMA fixtureディレクトリを参照する。
- `jmaVphwParser.test.ts` と `jmaVphwProcessor.test.ts` は共有するVPHW50／51 fixtureを同じファイル名で参照する。
- 既存の「公式サンプル」「実提供サンプル」等のテスト名は、入力の性質を示すため維持する。ただし絶対パスがない場合に `return` していたテストは、fixtureが存在しないことを明示的な失敗に変更する。
- 実行時コード不変を機械的に確認するため、製造前後で `git diff --name-only` を確認し、`apps/api/src/`、`apps/web/src/`、`packages/*/src/` に変更がないことを確認する。さらに `git diff -- apps/api/src packages/shared/src apps/web/src` が空であることを検収条件にする。

## 4. 変更対象と対象外

### 変更対象

- `apps/api/tests/fixtures/jma/` 配下の公式原文18件、既存VPBS50負例の移動、`manifest.json`
- 上記8テストファイルの読み込み先とfixture欠落時の扱い

### 対象外

- `apps/api/src/` および他workspaceの実行時コード
- XML parser／processorのロジック・型・API・DBスキーマ
- テストの業務期待値、追加の業務ケース、ネットワーク取得
- fixtureの自動ダウンロード、ハッシュ検証を本番テストへ組み込むこと
- 気象庁XML仕様・コード値・データ取得方式の新規確定

## 5. 実装手順

1. 18件の公式サンプルについて、出典URL、取得日時、取得直後のSHA-256を確認する。コピー元と一致しない・出典が公式でない・個別利用条件が見つかった場合は中断して統括へ報告する。
2. `apps/api/tests/fixtures/jma/` を作成し、18件をバイト列のままコピーする。既存VPBS50負例を同ディレクトリへ移動する。
3. 上記マニフェスト形式で全19件の来歴を記録し、コピー後／加工後のハッシュを算出する。原文18件は source と fixture のハッシュ一致を確認する。
4. 8テストファイルのローカル絶対パス・`samplesDir` をリポジトリ相対のfixtureディレクトリに置換し、skip分岐を必須fixtureのアサーションへ替える。
5. テスト更新前に各対象テストを一度実行して現在の期待値を採取し、更新後は同じテスト名・期待値で通ることを確認する。テスト入力を意図的に存在しないパスに変更して失敗する対照を1回確認して戻す。
6. lint、型検査、整形、API workspaceテストを実行する。

## 6. 受け入れ条件

- [ ] `rg -n '/Users/yuta/claudeworks/cmk-gsx/docs/|jmaxml_20260723_Samples' apps/api/tests/jmaVpfd51Parser.test.ts apps/api/tests/jmaVpfd51Processor.test.ts apps/api/tests/jmaVpwp50Parser.test.ts apps/api/tests/jmaEarlyWarningParser.test.ts apps/api/tests/jmaVpbs50Parser.test.ts apps/api/tests/jmaVpbs50Processor.test.ts apps/api/tests/jmaVphwParser.test.ts apps/api/tests/jmaVphwProcessor.test.ts` を実行し、対象8テストファイルから外部絶対パスおよび外部サンプルディレクトリ参照が0件であることを確認する。
- [ ] `apps/api/tests/fixtures/jma/` に表の18 XMLと既存VPBS50負例、`manifest.json` が存在することを確認する。
- [ ] `manifest.json` が有効なJSONであり、19件すべてに `path`、`kind`、`sourceUrl`、`sourceSha256`、`fixtureSha256`、`retrievedAt`、`purpose` があることを確認する。`derived` の既存VPBS50負例には `transform` と `editor` があることを確認する。
- [ ] 18件の `original` fixtureについて、`shasum -a 256` の出力がマニフェストの `sourceSha256` と `fixtureSha256` の両方に一致することを確認する。`derived` fixtureはマニフェストの `fixtureSha256` と一致し、原文との差異が `transform` に説明されていることを確認する。
- [ ] 8テストファイルのfixtureを一時的に存在しないパスへ変更して `npm run test -w apps/api -- <対象ファイル>` を実行し、fixture欠落をアサーション失敗として検出することを確認した後、変更を戻す。
- [ ] `npm run test -w apps/api` を、親ディレクトリの外部サンプルを利用できない環境でも実行し、全件成功することを確認する。
- [ ] `npm run lint`、`npm run typecheck`、`npm run format:check` が成功することを確認する。
- [ ] `git diff -- apps/api/src packages/shared/src apps/web/src` の出力が空であり、実行時コードが不変であることを確認する。

## 7. 後続Issueへの引き継ぎ

- 新たなJMA由来fixtureを追加・更新・加工するIssueは、必ず `manifest.json` を同時に更新し、原文か加工物かを区別する。
- 加工fixtureで電文の意味に関わる値を変える必要がある場合は、実データの証拠として扱わず、加工内容・編集責任・なぜ実データで代替できないかを記録する。
- XML仕様の確定根拠は本マニフェストの存在ではなく、公式資料・実データ・`data-acquisition-report.md` の照合で判断する。fixtureがあるだけで未確認の電文仕様を確定事項にしてはならない。

## 8. 未確認事項・要ヒアリング事項

なし。既存の外部サンプルを原文のままリポジトリ内fixtureへ移すこと、来歴を出典・加工有無・SHA-256で記録することはIssueの受け入れ条件から一意に導ける。実装時に公式サンプル配布URLまたは既存負例の原文SHA-256を確認できない場合のみ、推測せず統括へ報告する。
