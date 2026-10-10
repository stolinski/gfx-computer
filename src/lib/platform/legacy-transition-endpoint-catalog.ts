/**
 * The catalogue side of the legacy transition reader
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §3):
 * how a `transition.from` or `transition.to` slug is found. `filmFromPreset`
 * (`./film-ingress.ts`) reads a legacy transition Preset as a two-Scene Film and
 * does not import the catalogue itself, so every caller that opens a corpus
 * Preset passes this.
 */
import type { LegacyTransitionEndpoint } from './film-ingress';
import { posterKeyForPreset } from './posters';
import { getPresetBySlug } from './preset-catalog';

/**
 * The corpus Preset `slug` names, with the content key its poster uses, which
 * is what the Scene seeded from it records as its origin. `null` when the
 * catalogue has no such Preset.
 */
export function resolveLegacyTransitionEndpointFromCatalog(
	slug: string
): LegacyTransitionEndpoint | null {
	const preset = getPresetBySlug(slug);
	return preset === null ? null : { preset, contentKey: posterKeyForPreset(preset) };
}
