import packShowcase from '$lib/pack-showcase.json';

/**
 * What `/packs` shows for one Pack. The colours and typefaces come from
 * `pack-showcase.json`, which `pnpm gen:pack-showcase` derives from
 * `src/lib/packs/<slug>/manifest.ts`, and the still comes from
 * `pnpm capture:pack-dresses` — a real engine render of one composition under
 * that Pack. Only `feel` is written by hand.
 */
export interface PackSwatch {
	role: string;
	name: string;
	hex: string;
}

export interface PackTypeface {
	role: string;
	use: string;
	family: string;
}

export interface PackDress {
	slug: string;
	label: string;
	swatches: readonly PackSwatch[];
	faces: readonly PackTypeface[];
	feel: string;
	stillHref: string;
}

export interface PacksPage {
	/** The one composition every still renders, so the page can name what it is showing. */
	presetSlug: string;
	dresses: readonly PackDress[];
}

/**
 * How each Pack reads, in a sentence or two. This is the page's only prose:
 * every enumeration beside it — hexes, families — is derived, because a
 * transcribed value is a value that goes stale.
 */
const PACK_FEEL: Record<string, string> = {
	syntax:
		'Warm black with one loud yellow. Space Grotesk sets the display flat and graphic, Space Mono handles the small print. Nothing glows and nothing recedes — the accent does all the pointing.',
	'editorial-mono':
		'A cool near-black page with a serif voice. Playfair Display carries the display line, JetBrains Mono keeps the labels technical, and one cyan accent holds the two together.',
	'crt-terminal':
		'A screen, not a page. One phosphor green on dark glass, JetBrains Mono throughout, scanlines inside the pixels. Depth is a bloom halo, because light comes out of a screen rather than falling on it.',
	'clean-light':
		'Daylight. A near-white field, near-black ink, one blue accent, and Geist set plain. The Pack to reach for when the graphics should stay out of the footage’s way.',
	sentry:
		'Violet-black with hot-pink edges. White Rubik stays crisp against dark panels, with blurple details and lime signals. A night-mode console with a neon glow.'
};

export function getPacksPage(): PacksPage {
	return {
		presetSlug: packShowcase.presetSlug,
		dresses: packShowcase.packs.map((pack) => {
			const feel = PACK_FEEL[pack.slug];
			if (feel === undefined) {
				throw new Error(
					`Pack "${pack.slug}" is registered but has no paragraph on /packs. Write one in docs-site/src/lib/server/packs.ts.`
				);
			}
			return { ...pack, feel, stillHref: `/pack-stills/${pack.slug}.webp` };
		})
	};
}
