/**
 * Font readiness gate (general engine capability).
 *
 * Each Pack declares its typefaces (`PackManifest.fonts`). Built-in packs
 * register their `@font-face` rules from their own folder (`@fontsource`
 * imports); a User Pack's faces arrive at runtime through
 * `registerUserPackFontFaces` against the same-origin font cache (ADR-0055).
 * This module triggers the declared faces to load and resolves once they are
 * ready, so the HTML-in-Canvas capture — in both preview and export — never
 * rasterizes OS-fallback glyphs. The engine knows nothing about which
 * typefaces a channel uses; that is Pack data.
 */
import { listRuntimeUserPacks, PACK_REGISTRY } from './packs/registry';
import type { PackFont } from './packs/types';

let builtinFacesReady: Promise<void> | null = null;

/**
 * Characters from every script subset a Pack font may split its faces into
 * (Latin, Latin-1, Latin Extended, Greek, Cyrillic, sub/superscript digits).
 * `document.fonts.load` fetches only the subsets whose unicode-range covers
 * the sample, so without it a word like "α-Ketoglutarate" or "CO₂" would wait
 * on a lazy subset and the first captured frames would rasterize a fallback.
 */
const FONT_SUBSET_COVERAGE_SAMPLE = 'AaÅåŁłŒœαΩЖж₂²€';

function loadDeclaredFaces(fonts: readonly PackFont[]): Promise<unknown> {
	const loads: Promise<unknown>[] = [];
	for (const font of fonts) {
		const style = font.style ?? 'normal';
		for (const weight of font.weights ?? [400]) {
			// Trigger the lazy @font-face load; swallow per-face failures so one
			// missing face never blocks the whole render path.
			loads.push(
				document.fonts
					.load(`${style} ${weight} 1em "${font.family}"`, FONT_SUBSET_COVERAGE_SAMPLE)
					.catch(() => undefined)
			);
		}
	}
	return Promise.all(loads);
}

/** Every built-in Pack's faces, swept once: whichever built-in a Preset names, its fonts are ready. */
function loadBuiltinPackFaces(): Promise<void> {
	return loadDeclaredFaces(Object.values(PACK_REGISTRY).flatMap((pack) => pack.fonts ?? [])).then(
		() => undefined
	);
}

/**
 * Resolves once every built-in Pack's declared typefaces and every loaded User
 * Pack's declared typefaces are loaded. The built-in sweep is memoized; the
 * User Packs are re-swept on every call, because a pack can load between one
 * capture and the next. Safe to await from both the preview paint path and
 * export — the two share this gate, which is what keeps preview and export on
 * the same glyphs.
 */
export function fontsReady(): Promise<void> {
	if (typeof document === 'undefined' || !('fonts' in document)) {
		return Promise.resolve();
	}
	builtinFacesReady ??= loadBuiltinPackFaces();
	const userPackFonts = listRuntimeUserPacks().flatMap((pack) => pack.fonts ?? []);
	return Promise.all([builtinFacesReady, loadDeclaredFaces(userPackFonts)])
		.then(() => document.fonts.ready)
		.then(() => undefined);
}
