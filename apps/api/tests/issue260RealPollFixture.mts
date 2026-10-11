const documentPrefix = 'https://www.data.jma.go.jp/developer/xml/data/';
const documentName = (index: number) => `20261011000000_${index}_VPWW55_130000.xml`;

export function createRealPollFixture(count: number) {
  let active = false;
  let cycle = 0;
  const telegram = `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/"><Control><Title>試験警報</Title><DateTime>2026-10-11T00:00:00Z</DateTime><Status>通常</Status><EditorialOffice>試験</EditorialOffice><PublishingOffice>試験</PublishingOffice></Control><Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>試験警報</Title><ReportDateTime>2026-10-11T00:00:00Z</ReportDateTime><InfoType>発表</InfoType><InfoKind>試験</InfoKind><InfoKindVersion>1.0_0</InfoKindVersion><Headline><Information type="気象警報・注意報"><Item><Areas codeType="気象情報／細分区域等"><Area><Name>江東区</Name><Code>1310800</Code></Area></Areas></Item></Information></Headline></Head><Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"/></Report>`;
  const emptyFeed = '<feed xmlns="http://www.w3.org/2005/Atom"><id>fixture</id></feed>';
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith(documentPrefix))
      return new Response(telegram, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    if (url.includes('/developer/xml/feed/')) {
      const feed =
        active && url.endsWith('/extra.xml')
          ? `<feed xmlns="http://www.w3.org/2005/Atom"><id>fixture</id>${Array.from(
              { length: count },
              (_, index) => {
                const href = `${documentPrefix}${documentName(cycle * count + index)}`;
                return `<entry><id>${href}</id><title>試験警報</title><link rel="alternate" type="application/xml" href="${href}"/></entry>`;
              },
            ).join('')}</feed>`
          : emptyFeed;
      if (active && url.endsWith('/extra.xml')) cycle++;
      return new Response(feed, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    }
    return new Response('', { status: 200 });
  };
  return {
    fetchFn,
    activate: () => {
      active = true;
    },
    getCycle: () => cycle,
  };
}
