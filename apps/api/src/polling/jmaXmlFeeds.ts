import type { UtcIso8601String } from '@wx-viewer-poc/shared';

export type JmaXmlFeedKind = 'regular' | 'extra' | 'regular_l' | 'extra_l';
export type JmaXmlPollTrigger = 'scheduled' | 'initial' | 'recovery' | 'manual';

export interface JmaXmlFeedDefinition {
  readonly kind: JmaXmlFeedKind;
  readonly url: string;
  readonly sourceKind: string;
  readonly role: 'high_frequency' | 'long_term';
}

export interface AtomFeedEntry {
  readonly id: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly documentUrl: string;
}

export interface FeedPollResult {
  readonly feedKind: JmaXmlFeedKind;
  readonly discoveredCount: number;
  readonly skippedDuplicateCount: number;
  readonly downloadedCount: number;
  readonly failedDocumentCount: number;
}

export interface PollCycleResult {
  readonly trigger: JmaXmlPollTrigger;
  readonly startedAt: UtcIso8601String;
  readonly finishedAt: UtcIso8601String;
  readonly feedResults: readonly FeedPollResult[];
}

export const JMA_XML_FEED_DEFINITIONS: readonly JmaXmlFeedDefinition[] = [
  {
    kind: 'regular',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/regular.xml',
    sourceKind: 'xml_feed_regular',
    role: 'high_frequency',
  },
  {
    kind: 'extra',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml',
    sourceKind: 'xml_feed_extra',
    role: 'high_frequency',
  },
  {
    kind: 'regular_l',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/regular_l.xml',
    sourceKind: 'xml_feed_regular_long',
    role: 'long_term',
  },
  {
    kind: 'extra_l',
    url: 'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml',
    sourceKind: 'xml_feed_extra_long',
    role: 'long_term',
  },
] as const;

export function getFeedDefinition(kind: JmaXmlFeedKind): JmaXmlFeedDefinition {
  const def = JMA_XML_FEED_DEFINITIONS.find((f) => f.kind === kind);
  if (!def) {
    throw new Error(`Unknown feed kind: ${kind}`);
  }
  return def;
}

export function getFeedDefinitionsForTrigger(
  trigger: JmaXmlPollTrigger,
): readonly JmaXmlFeedDefinition[] {
  switch (trigger) {
    case 'scheduled':
    case 'manual':
      return JMA_XML_FEED_DEFINITIONS.filter((f) => f.role === 'high_frequency');
    case 'initial':
    case 'recovery':
      return JMA_XML_FEED_DEFINITIONS;
    default:
      throw new Error(`Unsupported poll trigger: ${trigger as string}`);
  }
}
