/**
 * CRT Terminal Pack typefaces.
 *
 * One family everywhere — the terminal has one voice
 * (docs/packs/crt-terminal/aesthetic.md § Type System). JetBrains Mono is the
 * channel's practical mono and is already self-hosted via `@fontsource`
 * (the Syntax kicker thread bundles the same woff2 files, so this adds no new
 * font assets); the imports here make the Pack self-sufficient if Syntax is
 * ever unloaded. The period feel comes from the phosphor MATERIAL (glow,
 * raster, persistence), never from bitmap/pixel faces — those read
 * retro-game at 4K and fail long-body readability (rejected by the aesthetic
 * doc).
 */
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import '@fontsource-variable/jetbrains-mono/index.css';

import type { PackFont } from '$lib/platform/packs/types';

// The `font-treatment` sweep routes EVERY pipeline through this family, so the
// preload list must cover every weight the swept CanvasSources actually set:
// 500 (kickers/bylines), 600 (labels), 700 (titles/stats), 800 (instance-stack,
// text-3d). Pipelines that ask for 900 (title-sequence, type-hero, newspaper
// masthead) render at 800 — JetBrains Mono's heaviest cut — via CSS weight
// matching, so 800 is the one that must be resident before capture.
export const crtTerminalFonts: readonly PackFont[] = [
	{ family: 'JetBrains Mono', weights: [400, 500, 600, 700, 800] },
	{ family: 'JetBrains Mono Variable', weights: [100, 600, 800] }
];
