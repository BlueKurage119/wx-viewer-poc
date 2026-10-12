import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateTrainingWarningBaseline,
  verifyTrainingWarningBaseline,
} from '../src/training/trainingWarningBaseline.js';

test('基準電文: 生成と検証が通り、DOM構造が設計書通りである', () => {
  // 固定時計（月末・年末・JST跨ぎを含むケース）
  const testCases = [
    // 通常
    {
      reportDateTime: '2026-10-12T12:00:00.000Z',
      controlDateTime: '2026-10-12T12:05:30.000Z',
    },
    // 月末・JST日付跨ぎ (UTC 10-31 16:00 -> JST 11-01 01:00)
    {
      reportDateTime: '2026-10-31T16:00:00.000Z',
      controlDateTime: '2026-10-31T16:01:00.000Z',
    },
    // 年末・JST年跨ぎ (UTC 12-31 16:30 -> JST 01-01 01:30)
    {
      reportDateTime: '2026-12-31T16:30:00.000Z',
      controlDateTime: '2026-12-31T16:30:15.000Z',
    },
  ];

  for (const tc of testCases) {
    const xml = generateTrainingWarningBaseline(tc);

    // 検証が合格すること
    assert.doesNotThrow(() => {
      verifyTrainingWarningBaseline(xml, tc);
    });

    // 独立した期待値の照合
    assert.ok(xml.includes('<Title>気象警報・注意報（Ｒ０６）（集約通報）</Title>'));
    assert.ok(xml.includes('<Status>訓練</Status>'));
    assert.ok(xml.includes('<Title>警戒・注意事項集約定時通報</Title>'));
    assert.ok(xml.includes('<InfoType>発表</InfoType>'));
    assert.ok(xml.includes('<InfoKind>気象警報・注意報</InfoKind>'));
    assert.ok(xml.includes('<InfoKindVersion>1.5_0</InfoKindVersion>'));
    assert.ok(xml.includes('<Text>＊＊＊これは訓練です＊＊＊</Text>'));
    assert.ok(!xml.includes('<Information'));
    assert.ok(xml.includes('<Status>発表警報・注意報はなし</Status>'));
    assert.ok(xml.includes('type="気象警報・注意報（府県予報区等）"'));
    assert.ok(xml.includes('type="気象警報・注意報（一次細分区域等）"'));
    assert.ok(xml.includes('type="気象警報・注意報（市町村等をまとめた地域等）"'));
    assert.ok(xml.includes('type="気象警報・注意報（市町村等）"'));
    assert.ok(xml.includes('<Code>130000</Code>'));
    assert.ok(xml.includes('<Code>130010</Code>'));
    assert.ok(xml.includes('<Code>130012</Code>'));
    assert.ok(xml.includes('<Code>1310800</Code>'));
    assert.ok(xml.includes('<DateTime type="発表時刻">'));
  }
});

test('基準電文: 不正な電文を verifyTrainingWarningBaseline が不合格にする', () => {
  const options = {
    reportDateTime: '2026-10-12T12:00:00.000Z',
    controlDateTime: '2026-10-12T12:05:00.000Z',
  };
  const validXml = generateTrainingWarningBaseline(options);

  // 1. Status を通常に変えたもの
  const normalStatusXml = validXml.replace('<Status>訓練</Status>', '<Status>通常</Status>');
  assert.throws(() => {
    verifyTrainingWarningBaseline(normalStatusXml, options);
  });

  // 2. Kind に警報を入れたもの
  const withWarningXml = validXml.replace(
    '<Status>発表警報・注意報はなし</Status>',
    '<Name>大雨警報</Name><Code>03</Code><Status>発表</Status>',
  );
  assert.throws(() => {
    verifyTrainingWarningBaseline(withWarningXml, options);
  });

  // 3. DateTime を Tb から変えたもの (市町村等の Kind/DateTime)
  const modifiedDateTimeXml = validXml.replace(
    /type="発表時刻">[^<]+</,
    'type="発表時刻">2026-10-12T20:59:00+09:00<',
  );
  assert.throws(() => {
    verifyTrainingWarningBaseline(modifiedDateTimeXml, options);
  });
});

/**
 * 設計書「訓練用 VPWS50 基準電文（H1）」の表を、生成関数とは別にここへ手で書き下した期待値。
 * tbJst は発表時刻 Tb（JST）、controlUtc は Control/DateTime（秒精度 UTC）のリテラルを渡す。
 */
function expectedBaselineXml(tbJst: string, controlUtc: string): string {
  const noWarning = (type: string, name: string, code: string, withDate: boolean): string[] => [
    `    <Warning type="${type}">`,
    '      <Item>',
    '        <Kind>',
    '          <Status>発表警報・注意報はなし</Status>',
    ...(withDate ? [`          <DateTime type="発表時刻">${tbJst}</DateTime>`] : []),
    '        </Kind>',
    '        <Area>',
    `          <Name>${name}</Name>`,
    `          <Code>${code}</Code>`,
    '        </Area>',
    '      </Item>',
    '    </Warning>',
  ];
  return (
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">',
      '  <Control>',
      '    <Title>気象警報・注意報（Ｒ０６）（集約通報）</Title>',
      `    <DateTime>${controlUtc}</DateTime>`,
      '    <Status>訓練</Status>',
      '    <EditorialOffice>気象庁</EditorialOffice>',
      '    <PublishingOffice>気象庁</PublishingOffice>',
      '  </Control>',
      '  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">',
      '    <Title>警戒・注意事項集約定時通報</Title>',
      `    <ReportDateTime>${tbJst}</ReportDateTime>`,
      `    <TargetDateTime>${tbJst}</TargetDateTime>`,
      '    <EventID/>',
      '    <InfoType>発表</InfoType>',
      '    <Serial/>',
      '    <InfoKind>気象警報・注意報</InfoKind>',
      '    <InfoKindVersion>1.5_0</InfoKindVersion>',
      '    <Headline>',
      '      <Text>＊＊＊これは訓練です＊＊＊</Text>',
      '    </Headline>',
      '  </Head>',
      '  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">',
      ...noWarning('気象警報・注意報（府県予報区等）', '東京都', '130000', false),
      ...noWarning('気象警報・注意報（一次細分区域等）', '東京地方', '130010', false),
      ...noWarning('気象警報・注意報（市町村等をまとめた地域等）', '２３区東部', '130012', false),
      ...noWarning('気象警報・注意報（市町村等）', '江東区', '1310800', true),
      '  </Body>',
      '</Report>',
    ].join('\n') + '\n'
  );
}

test('基準電文: 生成XMLが独立した期待値と完全一致する（通常・月末・年末のTb、JST日付跨ぎ）', () => {
  const cases = [
    {
      reportDateTime: '2026-10-12T12:00:00.000Z',
      controlDateTime: '2026-10-12T12:05:30.000Z',
      tbJst: '2026-10-12T21:00:00+09:00',
      controlUtc: '2026-10-12T12:05:30Z',
    },
    // 月末: UTC 10/31 16:00 は JST 11/01 01:00
    {
      reportDateTime: '2026-10-31T16:00:00.000Z',
      controlDateTime: '2026-10-31T16:01:00.000Z',
      tbJst: '2026-11-01T01:00:00+09:00',
      controlUtc: '2026-10-31T16:01:00Z',
    },
    // 年末: UTC 12/31 16:30 は JST 翌年 01/01 01:30
    {
      reportDateTime: '2026-12-31T16:30:00.000Z',
      controlDateTime: '2026-12-31T16:30:15.000Z',
      tbJst: '2027-01-01T01:30:00+09:00',
      controlUtc: '2026-12-31T16:30:15Z',
    },
    // 閏日の跨ぎ: UTC 2028-02-28 15:00 は JST 2028-02-29 00:00
    {
      reportDateTime: '2028-02-28T15:00:00.000Z',
      controlDateTime: '2028-02-28T15:00:59.000Z',
      tbJst: '2028-02-29T00:00:00+09:00',
      controlUtc: '2028-02-28T15:00:59Z',
    },
  ];
  for (const c of cases) {
    const xml = generateTrainingWarningBaseline(c);
    assert.equal(xml, expectedBaselineXml(c.tbJst, c.controlUtc), c.reportDateTime);
    // Tb は Head の2か所と市町村等の層の1か所だけ。上位3層の Kind には DateTime が無い。
    assert.equal(xml.split(c.tbJst).length - 1, 3);
    assert.equal(xml.includes('<Information'), false);
    assert.doesNotThrow(() => verifyTrainingWarningBaseline(xml, c));
  }
});
