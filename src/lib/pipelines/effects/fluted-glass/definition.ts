import { z } from 'zod';
import type { EffectPipelineDefinition } from '$lib/platform/pipelines/definition-types';
import { createOrientationParamOverridesSchema } from '$lib/utils/optical-geometry';

// Ported to WGSL from @paper-design/shaders `fluted-glass`
// (https://github.com/paper-design/shaders, Apache-2.0, © Lost Coast Labs, Inc.).
// Deliberate departures from the source:
//   - The image-fit/sizing system collapses to identity (the effect-chain input
//     is the already-composited frame).
//   - The source's grainMixer / grainOverlay features are omitted — grain is a
//     separate composable link in the GFX effect chain (`paper-grain`).
//   - The source's `u_colorBack` fill is dropped — background fills are the
//     composition's `backgroundFill`, never an effect param — and the final
//     output is masked by the frame's own silhouette (rubric E4).
//   - The gaussian blur accumulates the chain's premultiplied samples directly
//     (the source unpremultiplies/repremultiplies around a straight-alpha
//     image texture).

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const FlutedGlassParamsSchema = z.object({
	/** Flute lattice: parallel lines, irregular lines, wave, zigzag, or a 2D pattern. */
	shape: z.enum(['lines', 'linesIrregular', 'wave', 'zigzag', 'pattern']).default('lines'),
	/** Per-flute refraction profile. */
	distortionShape: z.enum(['prism', 'lens', 'contour', 'cascade', 'flat']).default('prism'),
	/** Flute width: 0 = ~200 flutes across, 1 = ~5. */
	size: z.number().min(0).max(1).default(0.3),
	/** Grid direction in degrees relative to the frame. */
	angle: z.number().min(0).max(180).default(0),
	/** Refraction strength within each flute (~0.35 keeps text legible through
	 *  the ribs; higher dissolves content into streaks). */
	distortion: z.number().min(0).max(1).default(0.35),
	/** Texture shift perpendicular to the flutes. */
	shift: z.number().min(-1).max(1).default(0),
	/** Extra stretch along the flute direction. */
	stretch: z.number().min(0).max(1).default(0),
	/** One-directional gaussian blur through the glass. */
	blur: z.number().min(0).max(1).default(0),
	/** Glass distortion and softness at the frame edges. */
	edges: z.number().min(0).max(1).default(0.3),
	/** Shadow gradient following the flute profile. */
	shadows: z.number().min(0).max(1).default(0.3),
	/** Thin bright strokes along the flute boundaries. */
	highlights: z.number().min(0).max(1).default(0.3),
	/** Margins scoping the glass region; content outside is untouched. */
	marginLeft: z.number().min(0).max(1).default(0),
	marginRight: z.number().min(0).max(1).default(0),
	marginTop: z.number().min(0).max(1).default(0),
	marginBottom: z.number().min(0).max(1).default(0),
	// The four margins scoping the pane, set anew for one orientation (ADR-0039 §4).
	orientationOverrides: createOrientationParamOverridesSchema(
		z.strictObject({
			marginLeft: z.number().min(0).max(1),
			marginRight: z.number().min(0).max(1),
			marginTop: z.number().min(0).max(1),
			marginBottom: z.number().min(0).max(1)
		})
	),
	colorShadow: z.string().regex(HEX_COLOR_PATTERN).default('#1a1a1a'),
	colorHighlight: z.string().regex(HEX_COLOR_PATTERN).default('#ffffff')
});

export type FlutedGlassParams = z.infer<typeof FlutedGlassParamsSchema>;

const FlutedGlassEffectSchema = z.object({
	type: z.literal('fluted-glass'),
	id: z.string(),
	params: FlutedGlassParamsSchema
});

export const flutedGlassEffectDefinition = {
	type: 'fluted-glass',
	label: 'Fluted glass',
	schema: FlutedGlassEffectSchema,
	orientationParams: ['marginLeft', 'marginRight', 'marginTop', 'marginBottom'],
	defaults: () => ({
		params: {
			shape: 'lines',
			distortionShape: 'prism',
			size: 0.3,
			angle: 0,
			distortion: 0.35,
			shift: 0,
			stretch: 0,
			blur: 0,
			edges: 0.3,
			shadows: 0.3,
			highlights: 0.3,
			marginLeft: 0,
			marginRight: 0,
			marginTop: 0,
			marginBottom: 0,
			colorShadow: '#1a1a1a',
			colorHighlight: '#ffffff'
		}
	})
} satisfies EffectPipelineDefinition<FlutedGlassParams>;
