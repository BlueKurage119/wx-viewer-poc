import type {
  MonitoringInformationKind,
  MonitoringInformationSection,
  VenueId,
} from '@wx-viewer-poc/shared';

export function createInformationSection(
  kind: MonitoringInformationKind,
  venueId: VenueId,
  overrides?: Partial<MonitoringInformationSection>,
): MonitoringInformationSection {
  const isBulletin = kind === 'bosai_bulletin';
  return {
    kind,
    venueId,
    availability: 'available',
    issuedAt: isBulletin ? null : '2026-09-20T05:20:00.000Z',
    validAt: isBulletin ? null : '2026-09-20T05:25:00.000Z',
    fetchedAt: isBulletin ? null : '2026-09-20T05:25:15.000Z',
    lastSuccessAt: isBulletin ? null : '2026-09-20T05:25:15.000Z',
    summaryCount: 1,
    ...overrides,
  };
}

/** API (buildInformationForVenue) と同じ 8 種（配列順は warning 始まり）を生成する */
export function createDefaultVenueInformation(
  venueId: VenueId,
): readonly MonitoringInformationSection[] {
  return [
    createInformationSection('warning', venueId, { summaryCount: 2 }),
    createInformationSection('warning_timeseries', venueId, { summaryCount: 5 }),
    createInformationSection('early_warning', venueId, { summaryCount: 4 }),
    createInformationSection('amedas', venueId, { summaryCount: 12 }),
    createInformationSection('area_timeseries', venueId, { summaryCount: 6 }),
    createInformationSection('bosai_bulletin', venueId, {
      issuedAt: null,
      validAt: null,
      fetchedAt: null,
      lastSuccessAt: null,
      summaryCount: 3,
    }),
    createInformationSection('nowcast', venueId, { summaryCount: 16 }),
    createInformationSection('kikikuru', venueId, { summaryCount: 20 }),
  ];
}

export function createDefaultInformation(): readonly MonitoringInformationSection[] {
  return [...createDefaultVenueInformation('east'), ...createDefaultVenueInformation('trc')];
}
