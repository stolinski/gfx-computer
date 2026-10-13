import { describe, expect, it } from 'vite-plus/test';

import { filmSceneDisplayName } from './film-scene-display-name';
import { getPresetBySlug } from './preset-catalog';

describe('filmSceneDisplayName', () => {
	it("shows the Scene's own name before anything else", () => {
		expect(
			filmSceneDisplayName(
				{ name: 'Cold open', origin: { slug: 'lower-third', contentKey: null } },
				0
			)
		).toBe('Cold open');
	});

	it('falls back to the name of the corpus Preset the Scene was seeded from', () => {
		const lowerThird = getPresetBySlug('lower-third');
		if (!lowerThird) throw new Error('The corpus holds no Preset "lower-third".');

		expect(filmSceneDisplayName({ origin: { slug: 'lower-third', contentKey: null } }, 4)).toBe(
			lowerThird.name
		);
	});

	it('counts the Scene from 1 when it has no name and no corpus Preset to borrow one from', () => {
		expect(filmSceneDisplayName({ origin: null }, 0)).toBe('Scene 1');
		expect(
			filmSceneDisplayName({ origin: { slug: 'no-such-corpus-preset', contentKey: null } }, 2)
		).toBe('Scene 3');
	});
});
