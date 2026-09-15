import { z } from 'zod';

import { RAW_TEXT_EFFECT_CATALOG } from './raw-catalog-bundle.ts';
import { GFX_TEXT_EFFECT_MODULES } from './gfx-effects/index.ts';

// Vendored upstream JSON, eager-bundled by `raw-catalog-bundle.ts` so the
// catalog is available both inside Vite (the production build via the
// import-glob bundler) and inside `node --experimental-strip-types` (used by
// `scripts/verify-presets.ts` and other CI tooling). See
// `raw-catalog-bundle.ts` for the loader rationale; see
// `raw-catalog/CATALOG_SOURCE.md` for upstream provenance.
//
// GFX-original effects (`kerning-pop`, `bracket-pop`, and the variable-font
// `weight-resolve`) merge in alongside the vendored set so the catalog lane
// stays a single registry from the consumer\'s perspective.
const { specModules } = RAW_TEXT_EFFECT_CATALOG;
const textEffectModules: Record<string, unknown> = {
	...RAW_TEXT_EFFECT_CATALOG.effectModules,
	...GFX_TEXT_EFFECT_MODULES
};

/**
 * The four split modes the catalog defines. Each effect names exactly one as
 * its `portable_spec.target`. GFX mirrors this term in `docs/CONTEXT.md` as
 * **Split mode**.
 */
export const TEXT_EFFECT_SPLIT_MODES = ['whole', 'per-character', 'per-word', 'per-line'] as const;
export type TextEffectSplitMode = (typeof TEXT_EFFECT_SPLIT_MODES)[number];

/**
 * The four renderer families GFX ships. The 20 `visibility: visible` upstream
 * effects choose one explicitly via `showcase.renderer.id`; the four hidden
 * effects (no showcase block) fall through to `generic-stagger`. GFX mirrors
 * this term in `docs/CONTEXT.md` as **Renderer family**.
 */
export const TEXT_EFFECT_RENDERER_FAMILIES = [
	'generic-stagger',
	'kinetic-center-build',
	'kinetic-top-build',
	'shared-slide-opacity-stage'
] as const;
export type TextEffectRendererFamily = (typeof TEXT_EFFECT_RENDERER_FAMILIES)[number];

/**
 * Optional ordering applied by the generic-stagger renderer on top of the
 * unit index. Maps the upstream `portable_spec.stagger_mode` field.
 */
export const TEXT_EFFECT_STAGGER_MODES = ['normal', 'reverse', 'center-out', 'edges-in'] as const;
export type TextEffectStaggerMode = (typeof TEXT_EFFECT_STAGGER_MODES)[number];

const KeyframeShapeSchema = z
	.object({
		opacity: z.number().optional(),
		x_px: z.number().optional(),
		y_px: z.number().optional(),
		z_px: z.number().optional(),
		blur_px: z.number().optional(),
		scale: z.number().optional(),
		rotate_deg: z.number().optional(),
		rotate_x_deg: z.number().optional(),
		rotate_y_deg: z.number().optional(),
		letter_spacing_em: z.number().optional(),
		font_weight_normalized: z.number().min(0).max(1).optional()
	})
	.passthrough();

const PhaseSchema = z.object({
	duration_ms: z.number(),
	stagger_ms: z.number().optional().default(0),
	easing: z.string(),
	from: KeyframeShapeSchema,
	to: KeyframeShapeSchema
});

const PortableSpecSchema = z
	.object({
		id: z.string(),
		display_name: z.string(),
		description: z.string(),
		target: z.enum(TEXT_EFFECT_SPLIT_MODES),
		signature_easing: z.string().optional(),
		stagger_mode: z.enum(TEXT_EFFECT_STAGGER_MODES).optional(),
		title_scale_only: z.boolean().optional(),
		requires_variable_weight: z.boolean().optional(),
		enter: PhaseSchema,
		exit: PhaseSchema.optional()
	})
	.passthrough();

const ShowcaseRuntimeSchema = z
	.object({
		speed_multiplier: z.number().optional(),
		hold_ms: z.number().optional(),
		gap_ms: z.number().optional(),
		y_travel_multiplier: z.number().optional(),
		initial_delay_ms: z.unknown().optional()
	})
	.passthrough();

const ShowcaseRendererSchema = z
	.object({
		id: z.enum(TEXT_EFFECT_RENDERER_FAMILIES),
		params: z.record(z.string(), z.unknown()).optional(),
		recipe: z.unknown().optional()
	})
	.passthrough();

const ShowcaseSchema = z
	.object({
		renderer: ShowcaseRendererSchema.optional(),
		runtime: ShowcaseRuntimeSchema.optional()
	})
	.passthrough();

const EffectFileSchema = z
	.object({
		id: z.string(),
		visibility: z.enum(['visible', 'hidden']),
		portable_spec: PortableSpecSchema,
		showcase: ShowcaseSchema.nullable().optional()
	})
	.passthrough();

const SpecFileSchema = PortableSpecSchema;

export type TextEffectKeyframeShape = z.infer<typeof KeyframeShapeSchema>;
export type TextEffectPhase = z.infer<typeof PhaseSchema>;
export type TextEffectPortableSpec = z.infer<typeof PortableSpecSchema>;
export type TextEffectShowcaseRuntime = z.infer<typeof ShowcaseRuntimeSchema>;

/** Runtime catalog definition for one Effect (text), never a post-process Effect Layer entry. */
export interface TextEffectSpec {
	id: string;
	displayName: string;
	description: string;
	visibility: 'visible' | 'hidden';
	target: TextEffectSplitMode;
	renderer: TextEffectRendererFamily;
	staggerMode: TextEffectStaggerMode;
	signatureEasing: string | null;
	/** Restrict the effect to title/kicker slots even when it splits by word. */
	titleScaleOnly: boolean;
	/** The effect needs the target Pipeline to accept the Pack's real `wght` face. */
	requiresVariableWeight: boolean;
	enter: TextEffectPhase;
	exit: TextEffectPhase | null;
	runtime: TextEffectShowcaseRuntime;
	/**
	 * Renderer-family-specific recipe params (only populated for the layout-aware
	 * renderers, copied through verbatim from `showcase.renderer.params`). Empty
	 * object for generic-stagger effects.
	 */
	rendererParams: Record<string, unknown>;
}

const DEFAULT_TEXT_EFFECT_RUNTIME: TextEffectShowcaseRuntime = {
	speed_multiplier: 1,
	hold_ms: 0,
	gap_ms: 0,
	y_travel_multiplier: 1
};

function narrowTextEffect(file: z.infer<typeof EffectFileSchema>): TextEffectSpec {
	const spec = file.portable_spec;
	const renderer = file.showcase?.renderer?.id ?? 'generic-stagger';
	const staggerMode = spec.stagger_mode ?? 'normal';
	const runtime = { ...DEFAULT_TEXT_EFFECT_RUNTIME, ...(file.showcase?.runtime ?? {}) };

	return {
		id: file.id,
		displayName: spec.display_name,
		description: spec.description,
		visibility: file.visibility,
		target: spec.target,
		renderer,
		staggerMode,
		signatureEasing: spec.signature_easing ?? null,
		titleScaleOnly: spec.title_scale_only ?? false,
		requiresVariableWeight: spec.requires_variable_weight ?? false,
		enter: spec.enter,
		exit: spec.exit ?? null,
		runtime,
		rendererParams: { ...(file.showcase?.renderer?.params ?? {}) }
	};
}

function buildTextEffectCatalog(): ReadonlyMap<string, TextEffectSpec> {
	const out = new Map<string, TextEffectSpec>();

	for (const [id, raw] of Object.entries(textEffectModules)) {
		const parsed = EffectFileSchema.safeParse(raw);

		if (!parsed.success) {
			throw new Error(
				`Text-animation effect catalog drift at effects/${id}.json:\n${parsed.error.message}`
			);
		}

		// Cross-check against the matching spec file when present — the upstream
		// pairs spec + effect and they should agree on id + target.
		const specRaw = specModules[parsed.data.id];
		if (specRaw) {
			const specCheck = SpecFileSchema.safeParse(specRaw);
			if (!specCheck.success) {
				throw new Error(
					`Text-animation spec catalog drift at specs/${parsed.data.id}.json:\n${specCheck.error.message}`
				);
			}

			if (specCheck.data.target !== parsed.data.portable_spec.target) {
				throw new Error(
					`Text-animation catalog mismatch: spec/${parsed.data.id} target ${specCheck.data.target} != effect target ${parsed.data.portable_spec.target}`
				);
			}
		}

		out.set(parsed.data.id, narrowTextEffect(parsed.data));
	}

	return out;
}

export const TEXT_EFFECT_CATALOG: ReadonlyMap<string, TextEffectSpec> = buildTextEffectCatalog();

export type TextEffectId = string;

/** Type predicate for Effect (text) ids at parse-time validators. */
export function isTextEffectId(value: string): value is TextEffectId {
	return TEXT_EFFECT_CATALOG.has(value);
}

/** Layout-aware renderers can only be applied to title-scale slots. */
export const LAYOUT_AWARE_TEXT_EFFECT_RENDERERS: ReadonlySet<TextEffectRendererFamily> = new Set([
	'kinetic-center-build',
	'kinetic-top-build',
	'shared-slide-opacity-stage'
]);

/** Slots the parse-time validators consider "title-scale". */
export const TEXT_ANIMATION_TITLE_SCALE_SLOTS: ReadonlySet<string> = new Set([
	'title',
	'kicker',
	'overlay:title',
	'overlay:kicker'
]);

/** Stable ordering of effect IDs for UI listings (catalog source order). */
export const TEXT_EFFECT_IDS: readonly TextEffectId[] = Array.from(TEXT_EFFECT_CATALOG.keys());
