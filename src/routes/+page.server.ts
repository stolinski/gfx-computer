import { committedCompositionPosterUrl } from '$lib/platform/composition-posters';
import { listPosterKeys } from '$lib/platform/poster-store.server';
import { posterKeyForPreset } from '$lib/platform/posters';
import { listFixtures, listPresets, type CataloguedPreset } from '$lib/platform/preset-catalog';
import { areDevelopmentOnlySurfacesServed } from '$lib/platform/public-runtime-profile.server';

import type { PageServerLoad } from './$types';

function homepagePresetCard(entry: CataloguedPreset) {
	return {
		slug: entry.slug,
		name: entry.preset.name,
		kind: entry.preset.kind,
		surfaceType: entry.preset.state.surface.type,
		// Chart Blocks and Figures (ADR-0067) are one library family: Charts.
		hasChart:
			entry.preset.state.surface.chart !== undefined ||
			(entry.preset.state.surface.figures?.length ?? 0) > 0,
		hasDepthStage: entry.preset.state.stage !== undefined,
		hasDepthOfField: entry.preset.state.effects.some((effect) => effect.type === 'depth-of-field'),
		durationSeconds: entry.preset.state.transport.durationSeconds,
		// The committed still of this exact content (ADR-0061), shipped with the
		// app on every origin; null when the poster is missing or stale, and the
		// card shows its Surface default instead.
		posterUrl: committedCompositionPosterUrl(entry.slug, posterKeyForPreset(entry.preset))
	};
}

// Keep full, frequently changing Presets on the server for the library view.
// The browser receives only the fields each card renders instead of importing
// and validating the complete engine catalog during hydration.
//
// Fixtures and the poster store are both development-only (ADR-0039, ADR-0053):
// a fixture documents an engine gap rather than shipping as a deliverable, and
// the public runtime has no disk-backed poster store to read. A public visitor
// gets the deliverable library and nothing else. Library posters are not the
// store's: they are committed assets, so the public library shows them too.
export const load: PageServerLoad = async () => {
	if (!areDevelopmentOnlySurfacesServed()) {
		return { posterKeys: [], presets: listPresets().map(homepagePresetCard), fixtures: [] };
	}
	return {
		posterKeys: await listPosterKeys(),
		presets: listPresets().map(homepagePresetCard),
		fixtures: listFixtures().map(homepagePresetCard)
	};
};
