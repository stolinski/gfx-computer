import { z } from 'zod';
import {
	DEFAULT_FROSTED_GLASS_REGION,
	NormalizedOpticalRegionSchema
} from '$lib/utils/optical-geometry';
import type { Keyframe } from '$lib/platform/engine-schema';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const FrostMeltSchema = z
	.object({
		center: z
			.object({
				x: z.number().min(0).max(1).default(0.5),
				y: z.number().min(0).max(1).default(0.5)
			})
			.default({ x: 0.5, y: 0.5 }),
		radius: z.number().min(0.01).max(1.5).default(0.28),
		softness: z.number().min(0.001).max(0.5).default(0.08),
		from: z.number().min(0).max(1).default(0.42),
		to: z.number().min(0).max(1).default(0.68),
		/** How far the hole has opened, 0..1. `from` / `to` drive it unless a channel takes the pen. */
		progress: z.number().min(0).max(1).default(0)
	})
	.refine((melt) => melt.to > melt.from, {
		message: 'Frost melt `to` must be greater than `from`.'
	});

const FrostedGlassParamsSchema = z
	.object({
		region: NormalizedOpticalRegionSchema.default(DEFAULT_FROSTED_GLASS_REGION),
		coverage: z.number().min(0).max(1).default(0.72),
		contrast: z.number().min(0.05).max(1).default(0.42),
		roughness: z.number().min(0).max(1).default(0.62),
		haze: z.number().min(0).max(1).default(0.68),
		refraction: z.number().min(0).max(1).default(0.26),
		detailScale: z.number().min(0.25).max(4).default(1.15),
		tint: z.string().regex(HEX_COLOR_PATTERN).default('#e8f1f5'),
		tintStrength: z.number().min(0).max(1).default(0.18),
		highlight: z.number().min(0).max(1).default(0.22),
		seed: z.number().int().min(0).max(65535).default(4107),
		growFrom: z.number().min(0).max(1).default(0),
		growTo: z.number().min(0).max(1).default(0.08),
		/** How far the frost has grown across the pane, 0..1. `growFrom` / `growTo` drive it unless a channel takes the pen. */
		growth: z.number().min(0).max(1).default(1),
		melt: FrostMeltSchema.optional()
	})
	.refine((params) => params.growTo > params.growFrom, {
		message: 'Frost growth `growTo` must be greater than `growFrom`.'
	});

export type FrostedGlassParams = z.infer<typeof FrostedGlassParamsSchema>;

// A two-point 0 → 1 ramp between transport fractions, in the `smooth` ease.
function frostRampTrack(from: number, to: number, durationMs: number): Keyframe[] {
	return [
		{ atMs: from * durationMs, value: 0 },
		{ atMs: to * durationMs, value: 1, ease: 'smooth' }
	];
}

const FrostedGlassEffectSchema = z.object({
	type: z.literal('frosted-glass'),
	id: z.string(),
	params: FrostedGlassParamsSchema
});

export const frostedGlassEffectDefinition = {
	type: 'frosted-glass',
	label: 'Frosted glass',
	schema: FrostedGlassEffectSchema,
	// The seed offsets the frost noise hash (ADR-0063 §3).
	frozenParams: ['seed'],
	// The grow and melt ramps are sugar over the `growth` and `melt.progress`
	// channels (ADR-0063 §8): no Preset changes, and a declared channel wins.
	keyframeSugar: (params, durationMs) => {
		const tracks: Partial<Record<string, Keyframe[]>> = {
			growth: frostRampTrack(params.growFrom, params.growTo, durationMs)
		};
		if (params.melt) {
			tracks['melt.progress'] = frostRampTrack(params.melt.from, params.melt.to, durationMs);
		}
		return tracks;
	},
	defaults: () => ({
		params: {
			region: { ...DEFAULT_FROSTED_GLASS_REGION },
			coverage: 0.72,
			contrast: 0.42,
			roughness: 0.62,
			haze: 0.68,
			refraction: 0.26,
			detailScale: 1.15,
			tint: '#e8f1f5',
			tintStrength: 0.18,
			highlight: 0.22,
			seed: 4107,
			growFrom: 0,
			growTo: 0.08,
			growth: 1
		}
	})
} satisfies EffectPipelineDefinition<FrostedGlassParams>;
