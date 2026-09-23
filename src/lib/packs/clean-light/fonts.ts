/**
 * Clean Light Pack typefaces.
 *
 * The Pack folder owns the `@font-face` registration — `@fontsource`
 * self-hosted woff2, nothing fetched at render time. The exported declaration
 * tells the engine which families/weights to await before the HTML-in-Canvas
 * capture (see `$lib/platform/fonts`).
 *
 * Geist is the register's native voice (measured at intake 2026-07-13:
 * vercel.com runs Geist display + Geist Mono uppercase eyebrow labels — the
 * product-demo label convention this Pack claims). Both families ship true
 * cuts 100–900; every weight claimed below exists as a real file — nothing
 * is synthesized (playbook § 2.2).
 */
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';

import type { PackFont } from '$lib/platform/packs/types';

export const cleanLightFonts: readonly PackFont[] = [
	{ family: 'Geist', weights: [400, 500, 600, 700] },
	{ family: 'Geist Variable', weights: [100, 500, 600] },
	{ family: 'Geist Mono', weights: [400, 500] }
];
