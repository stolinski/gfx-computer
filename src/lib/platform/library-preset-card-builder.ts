import { committedCompositionPosterUrl } from './composition-posters';
import { posterKeyForPreset } from './posters';

import type { LibraryPresetCard } from './library-preset-card';
import type { CataloguedPreset } from './preset-catalog';

/**
 * The library card of one catalogued Preset. Reads the committed poster map and
 * hashes the Preset, so it runs where the catalogue already is: the home page's
 * server load, and the Workspace's Scene picker when it opens. The card type and
 * its labels are `./library-preset-card.ts`, which a page can import without
 * either.
 */
export function buildLibraryPresetCard(entry: CataloguedPreset): LibraryPresetCard {
	return {
		slug: entry.slug,
		name: entry.preset.name,
		kind: entry.preset.kind,
		surfaceType: entry.preset.state.surface.type,
		hasChart:
			entry.preset.state.surface.chart !== undefined ||
			(entry.preset.state.surface.figures?.length ?? 0) > 0,
		hasDepthStage: entry.preset.state.stage !== undefined,
		hasDepthOfField: entry.preset.state.effects.some((effect) => effect.type === 'depth-of-field'),
		durationSeconds: entry.preset.state.transport.durationSeconds,
		posterUrl: committedCompositionPosterUrl(entry.slug, posterKeyForPreset(entry.preset))
	};
}
