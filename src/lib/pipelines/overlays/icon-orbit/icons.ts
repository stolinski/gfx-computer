/**
 * The Icon Orbit line icons, drawn as strokes in a -60..60 box so the glow can
 * light them like neon. Approved by Scott on 2026-10-14 as one set; an icon is
 * named for the concept it stands for, never for its shape.
 */
export interface IconOrbitGlyph {
	/** SVG path data, stroked; never filled. */
	paths: readonly string[];
	/** Shapes drawn filled (small dots), same coordinate box. */
	dots?: readonly { x: number; y: number; r: number }[];
}

export const ICON_ORBIT_GLYPHS = {
	storage: {
		paths: [
			'M-34 -30a34 11 0 1 0 68 0a34 11 0 1 0 -68 0',
			'M-34 -30v60c0 6 15 11 34 11s34-5 34-11v-60',
			'M-34 -10c0 6 15 11 34 11s34-5 34-11M-34 10c0 6 15 11 34 11s34-5 34-11'
		]
	},
	queue: {
		paths: [
			'M-33 -38h48a5 5 0 0 1 5 5v8a5 5 0 0 1 -5 5h-48a5 5 0 0 1 -5 -5v-8a5 5 0 0 1 5 -5z',
			'M-33 -9h48a5 5 0 0 1 5 5v8a5 5 0 0 1 -5 5h-48a5 5 0 0 1 -5 -5v-8a5 5 0 0 1 5 -5z',
			'M-33 20h48a5 5 0 0 1 5 5v8a5 5 0 0 1 -5 5h-48a5 5 0 0 1 -5 -5v-8a5 5 0 0 1 5 -5z',
			'M38 -38v74M29 27l9 9 9-9'
		]
	},
	socket: {
		paths: [
			'M-48 12h14',
			'M-34 -6h18a18 18 0 0 1 0 36h-18z',
			'M2 2h10M2 22h10',
			'M48 12h-14M34 -6h-12v36h12',
			'M-14 -28c8-8 20-8 28 0M-24 -40c14-14 34-14 48 0'
		]
	},
	steer: {
		paths: [
			'M-40 0a40 40 0 1 0 80 0a40 40 0 1 0 -80 0',
			'M-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
			'M-10 0h-30M10 0h30M0 10v30'
		]
	},
	fork: {
		paths: [
			'M-28 36a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
			'M-28 -36a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
			'M16 -20a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
			'M-20 28v-56M24 -12c0 22-44 14-44 34'
		]
	},
	approval: {
		paths: [
			'M-20 -26h40a26 26 0 0 1 0 52h-40a26 26 0 0 1 0 -52z',
			'M4 0a16 16 0 1 0 32 0a16 16 0 1 0 -32 0',
			'M-32 0l8 8 13-15'
		]
	},
	retry: {
		paths: ['M38 -2a38 38 0 1 1 -12 -26', 'M28 -44v18h-18'],
		dots: [{ x: 0, y: 0, r: 5 }]
	},
	summary: {
		paths: ['M-40 -36h80M-40 -24h80M-40 -12h64', 'M-10 0l10 10 10-10', 'M-24 32h48']
	},
	state: {
		paths: [
			'M-44 -24h20a6 6 0 0 1 6 6v32a6 6 0 0 1 -6 6h-20a6 6 0 0 1 -6 -6v-32a6 6 0 0 1 6 -6z',
			'M24 -24h20a6 6 0 0 1 6 6v32a6 6 0 0 1 -6 6h-20a6 6 0 0 1 -6 -6v-32a6 6 0 0 1 6 -6z',
			'M-41 -10h14M-41 2h10M27 -10h14M27 2h10',
			'M-10 -8h20M4 -14l6 6-6 6M10 10h-20M-4 4l-6 6 6 6'
		]
	},
	memory: {
		paths: [
			'M-30 -44h60a14 14 0 0 1 14 14v60a14 14 0 0 1 -14 14h-60a14 14 0 0 1 -14 -14v-60a14 14 0 0 1 14 -14z',
			'M-12 -18h24a6 6 0 0 1 6 6v24a6 6 0 0 1 -6 6h-24a6 6 0 0 1 -6 -6v-24a6 6 0 0 1 6 -6z',
			'M-26 -44v-12M0 -44v-12M26 -44v-12M-26 44v12M0 44v12M26 44v12M-44 -26h-12M-44 0h-12M-44 26h-12M44 -26h12M44 0h12M44 26h12'
		]
	},
	streams: {
		paths: [
			'M-60 -24c20 -20 40 20 60 0s40 -20 60 0',
			'M-60 4c20 -20 40 20 60 0s40 -20 60 0',
			'M-60 32c20 -20 40 20 60 0s40 -20 60 0'
		]
	}
} as const satisfies Record<string, IconOrbitGlyph>;

export type IconOrbitGlyphName = keyof typeof ICON_ORBIT_GLYPHS;

export const ICON_ORBIT_GLYPH_NAMES = Object.keys(ICON_ORBIT_GLYPHS) as [
	IconOrbitGlyphName,
	...IconOrbitGlyphName[]
];
