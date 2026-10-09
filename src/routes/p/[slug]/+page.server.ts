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
 */
export const load = (async ({ params, url }) => {
	const slug = params.slug;
	const source = url.searchParams.get('source') === 'builtin' ? ('builtin' as const) : null;
	const corpusPreset = getPresetBySlug(slug);
	const served =
		corpusPreset !== null &&
		(corpusPreset.kind !== 'fixture' || areDevelopmentOnlySurfacesServed());

	return { slug, source, corpusPreset: served ? corpusPreset : null };
}) satisfies PageServerLoad;
