import { listPosterKeys } from '$lib/platform/poster-store.server';
import { getPresetBySlug } from '$lib/platform/preset-catalog';
import { areDevelopmentOnlySurfacesServed } from '$lib/platform/public-runtime-profile.server';

import type { PageServerLoad } from './$types';

/**
 * Only the corpus half of this route resolves here. A slug that is not a corpus
 * Preset's names a session composition, which lives in the store the browser is
 * configured with, and a browser-scoped session is one the origin cannot see
 * and must never be sent — so the page resolves that half itself, against the
 * same store WebMCP uses (ADR-0053). What the server knows is the Starter this
 * build ships, and a corpus slug always opens that Starter (ADR-0068 §3).
 *
 * A public host knows one Starter fewer: a fixture is development-only
 * (ADR-0039), so its slug resolves to nothing there rather than opening a
 * composition the homepage does not list.
 *
 * `posterKeys` are the User composition posters the disk store holds, for the
 * Add to Film menu's thumbnails, read the way the home page's load reads them:
 * a public host has no poster store and reports none.
 */
export const load = (async ({ params }) => {
	const slug = params.slug;
	const corpusPreset = getPresetBySlug(slug);
	const developmentOnlySurfacesServed = areDevelopmentOnlySurfacesServed();
	const served =
		corpusPreset !== null && (corpusPreset.kind !== 'fixture' || developmentOnlySurfacesServed);

	return {
		slug,
		corpusPreset: served ? corpusPreset : null,
		posterKeys: developmentOnlySurfacesServed ? await listPosterKeys() : []
	};
}) satisfies PageServerLoad;
