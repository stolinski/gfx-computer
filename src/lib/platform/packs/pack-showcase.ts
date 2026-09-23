/**
 * What a Pack looks like, reduced to the few values a reader can be shown: the
 * four mandatory colour cores (ADR-0024) and the type voice the Pack speaks in.
 *
 * docs.gfx.computer/packs prints these next to a real render of one composition
 * under each Pack. Nothing there is transcribed by hand —
 * `scripts/generate-pack-showcase.ts` writes this derivation into
 * `docs-site/src/lib/pack-showcase.json`, and `pack-showcase.test.ts` fails when
 * the published file and these manifests disagree, so a hex or a family only
 * ever changes in the manifest.
 */

import { PACK_REGISTRY, PACK_REGISTRY_SLUGS } from './registry';
import { isColorValue, requireCoreColor, resolveFontTreatment } from './resolve';
import type { PackManifest } from './types';

/**
 * The composition the docs site dresses in every Pack: one full-frame chapter
 * card, so a single still carries the Pack's field, its card type, and its
 * accent at once. `scripts/capture-pack-dresses.ts` renders exactly this frame.
 */
export const PACK_SHOWCASE_FRAME_SPEC = {
	presetSlug: 'chapter-card-descent',
	orientation: 'horizontal',
	progress: 0.5
} as const;

export type PackShowcaseSwatchRole =
	'field-treatment' | 'fill-treatment' | 'ink-treatment' | 'accent-treatment';

/** One core colour a Pack claims, named for a reader rather than for the engine. */
export interface PackShowcaseSwatch {
	role: PackShowcaseSwatchRole;
	name: string;
	hex: string;
}

/** One typeface a Pack speaks in — the first family named in a font-stack Role. */
export interface PackShowcaseFace {
	role: 'font-treatment' | 'font-label-treatment';
	use: string;
	family: string;
}

export interface PackShowcase {
	slug: string;
	label: string;
	swatches: readonly PackShowcaseSwatch[];
	faces: readonly PackShowcaseFace[];
}

/**
 * The four colour cores in the order a reader meets them on screen: the field
 * behind everything, the card sitting on it, the ink on the card, the accent
 * that points. The optional `field-ink-treatment` core is deliberately absent —
 * on every shipped Pack it either repeats the ink or restates the fill, so a
 * fifth chip would add a swatch without adding a claim.
 */
const SHOWCASE_SWATCH_ROLES: readonly { role: PackShowcaseSwatchRole; name: string }[] = [
	{ role: 'field-treatment', name: 'Field' },
	{ role: 'fill-treatment', name: 'Card' },
	{ role: 'ink-treatment', name: 'Ink' },
	{ role: 'accent-treatment', name: 'Accent' }
];

/** `"'Space Grotesk', 'Inter', sans-serif"` → `Space Grotesk`. */
function readPrimaryFontFamily(stack: string): string {
	const family = stack
		.split(',')[0]
		.trim()
		.replace(/^["']|["']$/g, '')
		.trim();
	if (family.length === 0) {
		throw new TypeError(`Font stack "${stack}" names no family.`);
	}
	return family;
}

/** The Pack's small-label voice, or `null` for a Pack that speaks one family everywhere. */
function readLabelFontStack(manifest: PackManifest): string | null {
	const role = manifest.roles['font-label-treatment'];
	if (!role || role.kind !== 'style' || typeof role.value !== 'string') return null;
	return role.value;
}

export function derivePackShowcase(manifest: PackManifest): PackShowcase {
	const swatches = SHOWCASE_SWATCH_ROLES.map(({ role, name }) => {
		const hex = requireCoreColor(manifest, role);
		if (!isColorValue(hex)) {
			throw new Error(`Pack "${manifest.slug}" core "${role}" is not a colour: "${hex}".`);
		}
		return { role, name, hex };
	});

	const displayStack = resolveFontTreatment(manifest);
	if (displayStack === null) {
		throw new Error(`Pack "${manifest.slug}" claims no "font-treatment" type voice.`);
	}
	const faces: PackShowcaseFace[] = [
		{ role: 'font-treatment', use: 'Display', family: readPrimaryFontFamily(displayStack) }
	];

	// crt-terminal drives one mono voice and sets no label core; naming the same
	// family twice would invent a pairing the Pack does not claim.
	const labelStack = readLabelFontStack(manifest);
	const labelFamily = labelStack === null ? null : readPrimaryFontFamily(labelStack);
	if (labelFamily !== null && labelFamily !== faces[0].family) {
		faces.push({ role: 'font-label-treatment', use: 'Labels', family: labelFamily });
	}

	return { slug: manifest.slug, label: manifest.label, swatches, faces };
}

/** Every registered Pack, in registry order. */
export function derivePackShowcaseCatalog(): readonly PackShowcase[] {
	return PACK_REGISTRY_SLUGS.map((slug) => derivePackShowcase(PACK_REGISTRY[slug]));
}
