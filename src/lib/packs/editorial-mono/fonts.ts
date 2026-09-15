/**
 * Editorial Mono Pack typefaces.
 *
 * The Pack folder owns the actual `@font-face` registration — here via
 * `@fontsource` self-hosted woff2, so nothing is fetched from a third party at
 * render time. The exported `editorialMonoFonts` declaration tells the engine
 * which families/weights to await before the HTML-in-Canvas capture (see
 * `$lib/platform/fonts`), so renders never fall back to OS Georgia/Helvetica.
 *
 * The Pack's type voice per `docs/packs/editorial-mono/aesthetic.md`: a heavy
 * display serif for headlines (Playfair Display, with EB Garamond as the
 * bundled fallback tier) and JetBrains Mono caps for the signature thread
 * (kicker / byline / dateline).
 */
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/800.css';
import '@fontsource-variable/playfair-display/index.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';

import type { PackFont } from '$lib/platform/packs/types';

export const editorialMonoFonts: readonly PackFont[] = [
	{ family: 'Playfair Display', weights: [600, 700, 800] },
	{ family: 'Playfair Display Variable', weights: [400, 700, 900] },
	{ family: 'EB Garamond', weights: [400, 500, 700] },
	{ family: 'JetBrains Mono', weights: [400, 500, 700] }
];
