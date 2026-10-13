import { describe, expect, it } from 'vite-plus/test';

import {
	COMMITTED_COMPOSITION_POSTERS,
	committedCompositionPosterUrl,
	listCommittedPosterAssetSlugs
} from './composition-posters';
import { posterKeyForPreset } from './posters';
import { listFixtures, listPresets } from './preset-catalog';

const REGENERATE = 'run `pnpm capture:posters` and commit the result';

/**
 * The freshness gate (ADR-0061): a Preset cannot land with a poster rendered
 * from a different version of itself, and a deliverable cannot land without
 * one. Fixtures may go without a poster — they document engine gaps and some
 * do not render — but one they do carry must be current.
 */
describe('committed composition posters', () => {
	it('gives every deliverable a poster rendered from its current content', () => {
		const stale = listPresets()
			.filter((entry) => {
				const poster = COMMITTED_COMPOSITION_POSTERS[entry.slug];
				return poster === undefined || poster.contentKey !== posterKeyForPreset(entry.preset);
			})
			.map((entry) => entry.slug);
		expect(stale, `deliverables without a current poster — ${REGENERATE}`).toEqual([]);
	});

	it('keeps every fixture poster it carries current', () => {
		const stale = listFixtures()
			.filter((entry) => {
				const poster = COMMITTED_COMPOSITION_POSTERS[entry.slug];
				return poster !== undefined && poster.contentKey !== posterKeyForPreset(entry.preset);
			})
			.map((entry) => entry.slug);
		expect(stale, `fixtures whose poster is stale — ${REGENERATE}`).toEqual([]);
	});

	it('has a still on disk for every manifest row, and a manifest row for every still', () => {
		const manifestSlugs = Object.keys(COMMITTED_COMPOSITION_POSTERS).sort();
		expect(listCommittedPosterAssetSlugs(), `manifest and stills disagree — ${REGENERATE}`).toEqual(
			manifestSlugs
		);
	});

	it('names only Presets the catalog still lists', () => {
		const catalogued = new Set([...listPresets(), ...listFixtures()].map((entry) => entry.slug));
		const orphans = Object.keys(COMMITTED_COMPOSITION_POSTERS).filter(
			(slug) => !catalogued.has(slug)
		);
		expect(orphans, `posters for Presets the catalog no longer lists — ${REGENERATE}`).toEqual([]);
	});

	it('resolves a URL only for the exact content the poster was rendered from', () => {
		const [entry] = listPresets();
		const key = posterKeyForPreset(entry.preset);
		// Dev keeps the `?no-inline` query on the URL; the build hashes it away.
		expect(committedCompositionPosterUrl(entry.slug, key)).toMatch(/\.webp(\?no-inline)?$/);
		expect(committedCompositionPosterUrl(entry.slug, 'ffffffffffffffff')).toBeNull();
		expect(committedCompositionPosterUrl('no-such-preset', key)).toBeNull();
	});
});
