import { buildLibraryPresetCard } from '$lib/platform/library-preset-card-builder';
import { listPosterKeys } from '$lib/platform/poster-store.server';
import { listFixtures, listPresets } from '$lib/platform/preset-catalog';
import { areDevelopmentOnlySurfacesServed } from '$lib/platform/public-runtime-profile.server';

import type { PageServerLoad } from './$types';

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
		return { posterKeys: [], presets: listPresets().map(buildLibraryPresetCard), fixtures: [] };
	}
	return {
		posterKeys: await listPosterKeys(),
		presets: listPresets().map(buildLibraryPresetCard),
		fixtures: listFixtures().map(buildLibraryPresetCard)
	};
};
