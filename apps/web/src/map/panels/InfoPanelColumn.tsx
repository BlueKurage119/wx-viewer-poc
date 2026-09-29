/**
 * 6パネルを §5.2 の順に並べる (G1)。`MapInformationColumnSlot` の children として渡す。
 */
import { PANEL_DEFINITIONS, type InfoPanelColumnInput } from './panelDefinitions';
import { resolvePanelTarget } from './panelTargets';
import type { Venue } from '../../shell/config';
import { sortCardsByTimeDescending } from './panelSort';
import { InfoPanelFrame } from './InfoPanelFrame';
import { DEFAULT_INFO_PANEL_INPUT, resolvePanelFixtureInput } from './panelFixtures';

export interface InfoPanelColumnProps {
  readonly venue: Venue;
  /** 省略時は既定値（全パネル loading）。開発ビルドでは `?panelFixture=` が優先される。 */
  readonly input?: InfoPanelColumnInput;
}

export function InfoPanelColumn({ venue, input }: InfoPanelColumnProps) {
  const resolvedInput = resolvePanelFixtureInput(input) ?? input ?? DEFAULT_INFO_PANEL_INPUT;

  return (
    <>
      {PANEL_DEFINITIONS.map((definition) => {
        const cards = sortCardsByTimeDescending(resolvedInput[definition.id] ?? []);
        const defaultTarget = resolvePanelTarget(venue.weatherTargets, definition.id);

        return cards.map((card) => (
          <InfoPanelFrame
            key={`${definition.id}-${card.key}`}
            definition={definition}
            heading={card.heading}
            target={card.target ?? defaultTarget}
            status={card.status}
            issuedTimes={card.issuedTimes}
          >
            {card.content}
          </InfoPanelFrame>
        ));
      })}
    </>
  );
}
