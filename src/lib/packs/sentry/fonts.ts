/**
 * Sentry Pack typefaces.
 *
 * The Pack folder owns the `@font-face` registration — `@fontsource`
 * self-hosted woff2, nothing fetched at render time. The exported declaration
 * tells the engine which family/weights to await before the HTML-in-Canvas
 * capture (see `$lib/platform/fonts`).
 *
 * Intake 2026-09-01 (sentry.io/welcome, computed styles): Rubik is the site's
 * one web face — body 400, nav / buttons / eyebrows 500 and 700 in caps. The
 * hero face ("Dammit Sans" bold) is a custom cut Google Fonts does not ship, so
 * Rubik 700 carries display too: the same rounded geometric family the site
 * already speaks in, at the weight its headings measure. Every cut below is a
 * real file in `@fontsource/rubik` (300–900 ship; nothing is synthesized,
 * playbook § 2.2).
 */
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import '@fontsource-variable/rubik/index.css';

import type { PackFont } from '$lib/platform/packs/types';

export const sentryFonts: readonly PackFont[] = [
	{ family: 'Rubik', weights: [400, 500, 700] },
	{ family: 'Rubik Variable', weights: [300, 650, 700] }
];
