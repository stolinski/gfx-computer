/**
 * Syntax Pack typefaces.
 *
 * The Pack folder owns the actual `@font-face` registration — here via
 * `@fontsource` self-hosted woff2, so nothing is fetched from a third party at
 * render time. The exported `syntaxFonts` declaration tells the engine which
 * families/weights to await before the HTML-in-Canvas capture (see
 * `$lib/platform/fonts`), so renders never fall back to OS Georgia/Helvetica.
 *
 * Family names below match exactly the `font-family` values the Surface /
 * Overlay CanvasSources reference. Operator Mono (the channel's ideal mono per
 * `docs/packs/syntax/aesthetic.md`) is commercial and not self-hostable;
 * JetBrains Mono is the documented open fallback and the practical channel mono.
 */
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/700.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/800.css';
import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// The live-overlay brand faces (github.com/randyrektor/syntax-overlay — the
// real Syntax house style, calibration 2026-07-09): Space Grotesk display,
// Space Mono labels/chrome.
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';

import type { PackFont } from '$lib/platform/packs/types';

export const syntaxFonts: readonly PackFont[] = [
	{ family: 'EB Garamond', weights: [400, 500, 700] },
	{ family: 'Playfair Display', weights: [600, 700, 800] },
	{ family: 'Old Standard TT', weights: [400, 700] },
	{ family: 'JetBrains Mono', weights: [400, 500, 700] },
	{ family: 'Inter', weights: [400, 600, 700] },
	{ family: 'Space Grotesk', weights: [500, 700] },
	{ family: 'Space Grotesk Variable', weights: [300, 650, 700] },
	{ family: 'Space Mono', weights: [400, 700] }
];
