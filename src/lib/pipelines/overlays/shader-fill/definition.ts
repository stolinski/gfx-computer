import { z } from 'zod';
import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import {
	DEFAULT_COLOR_0,
	DEFAULT_COLOR_1,
	DEFAULT_COLOR_2,
	DEFAULT_FLOW_SPEED,
	DEFAULT_OPACITY
} from './shader-fill-defaults';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

/**
 * `shader-fill` — first WGSL-rendered Overlay, validating the ADR-0005
 * `OverlayRenderer.shaderPass` path end-to-end. Paints a three-colour
 * smooth-mesh gradient inside the overlay's rect using inverse-square-distance
 * metaball blending of three time-driven centres. Animation comes from the
 * timeline's `progress`, threaded through `ShaderPass.packUniforms(...,
 * ctx)` per ADR-0013.
 *
 * Outside the rect: pass-through (the substrate behind the overlay shows
 * unchanged). Inside the rect: the gradient blends over the substrate at
 * `opacity`, never punching out alpha so the transparent-overlay export
 * contract holds. Drop-in for any Preset that wants a generated colour panel
 * — not bound to the channel aesthetic.
 */

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB hex color');

const ShaderFillContentSchema = z.object({
	color0: HexColorSchema.optional(),
	color1: HexColorSchema.optional(),
	color2: HexColorSchema.optional(),
	flowSpeed: z.number().min(0).max(4).optional(),
	opacity: z.number().min(0).max(1).optional()
});

export type ShaderFillContent = z.infer<typeof ShaderFillContentSchema>;

function defaults(): OverlayDefaults<ShaderFillContent> {
	return {
		content: {
			color0: DEFAULT_COLOR_0,
			color1: DEFAULT_COLOR_1,
			color2: DEFAULT_COLOR_2,
			flowSpeed: DEFAULT_FLOW_SPEED,
			opacity: DEFAULT_OPACITY
		},
		// Centered 40% × 30% rect via normalized-rect so the size is part of the
		// position contract; authors can drag-resize or swap to anchor+offset.
		position: { anchor: 'normalized-rect', rect: { x: 0.3, y: 0.35, width: 0.4, height: 0.3 } },
		enter: { start: 0, duration: 0.108, ease: 'settled' },
		exit: { start: 0.915, duration: 0.085, ease: 'smooth' }
	};
}

export const shaderFillOverlayDefinition = {
	type: 'shader-fill',
	label: 'Shader fill',
	schema: ShaderFillContentSchema,
	defaults,
	readableText: () => [],
	ownShaderPass: true
} satisfies OverlayPipelineDefinition<ShaderFillContent>;
