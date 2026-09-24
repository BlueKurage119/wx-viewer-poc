/**
 * 6パネルを §5.2 の順に並べる (G1)。`MapInformationColumnSlot` の children として渡す。
 */
import type { VenueId } from '@wx-viewer-poc/shared';
import { PANEL_DEFINITIONS, type InfoPanelColumnInput } from './panelDefinitions';
import { resolvePanelTarget } from './panelTargets';
import { sortCardsByTimeDescending } from './panelSort';
import { InfoPanelFrame } from './InfoPanelFrame';
import { DEFAULT_INFO_PANEL_INPUT, resolvePanelFixtureInput } from './panelFixtures';

export interface InfoPanelColumnProps {
  readonly venueId: VenueId;
  /** 省略時は既定値（全パネル loading）。開発ビルドでは `?panelFixture=` が優先される。 */
  readonly input?: InfoPanelColumnInput;
}

export function InfoPanelColumn({ venueId, input }: InfoPanelColumnProps) {
  const resolvedInput = resolvePanelFixtureInput() ?? input ?? DEFAULT_INFO_PANEL_INPUT;

  return (
    <>
      {PANEL_DEFINITIONS.map((definition) => {
        const cards = sortCardsByTimeDescending(resolvedInput[definition.id] ?? []);
        const target = resolvePanelTarget(venueId, definition.id);

        return cards.map((card) => (
          <InfoPanelFrame
            key={`${definition.id}-${card.key}`}
            definition={definition}
            heading={card.heading}
            target={target}
            status={card.status}
          >
            {card.content}
          </InfoPanelFrame>
        ));
      })}
    </>
  );
}
