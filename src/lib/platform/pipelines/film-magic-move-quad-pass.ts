import tgpu, { d } from 'typegpu';

import type { FilmMagicMoveQuad } from '$lib/platform/film-magic-move-quad';
import type { GpuHost } from '$lib/platform/gpu-host';
import type { OrientedRectPx } from '$lib/utils/oriented-rect';

/**
 * The quad a magic move draws for one pair
 * ([ADR-0068](../../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §5),
 * over a frame the boundary's fade or effect has already composited.
 *
 * Its two inputs are the element's own captures, one from each Scene: frame-
 * sized, straight-alpha, with the element where that Scene laid it out. Every
 * output pixel is placed in the quad's own box (`quad.rect`), then looked up at
 * the same place of the element's box in each capture (`quad.from`,
 * `quad.to`), so each capture's box lands on the quad whatever its position,
 * size, and rotation. The two are cross-faded, `out × (1 − mix) + in × mix`, in
 * premultiplied alpha, and blended over the frame as premultiplied source-over.
 *
 * The lookup is not cut off at the box's edge. A capture holds nothing but the
 * element, so what the element paints outside its box (a shadow, a glow) comes
 * along at the same scale, and everything further out is transparent. The pass
 * therefore covers the whole frame and writes nothing where the element is not.
 *
 * Captures are sampled with four exact texel reads, premultiplied before they
 * are weighted, so a soft edge never picks up colour from a transparent texel.
 */
const FilmMagicMoveQuadUniforms = d.struct({
	// Each box: (centerX, centerY, width, height) in canvas pixels.
	quadBox: d.vec4f,
	fromBox: d.vec4f,
	toBox: d.vec4f,
	// (quad, from, to) rotations in radians, clockwise with y down, then the mix.
	turnsAndMix: d.vec4f,
	resolution: d.vec2f
});

const fullScreenVertexFn = tgpu['~unstable'].vertexFn({
	in: { vertexIndex: d.builtin.vertexIndex },
	out: { position: d.builtin.position, uv: d.vec2f }
}) /* wgsl */ `{
	var positions = array<vec2f, 3>(
		vec2f(-1.0, -1.0),
		vec2f(3.0, -1.0),
		vec2f(-1.0, 3.0)
	);
	var uvs = array<vec2f, 3>(
		vec2f(0.0, 1.0),
		vec2f(2.0, 1.0),
		vec2f(0.0, -1.0)
	);
	return Out(vec4f(positions[in.vertexIndex], 0.0, 1.0), uvs[in.vertexIndex]);
}`;

const quadLayout = tgpu.bindGroupLayout({
	fromTexture: { texture: d.texture2d(d.f32) },
	toTexture: { texture: d.texture2d(d.f32) },
	uniforms: { uniform: FilmMagicMoveQuadUniforms }
});

/**
 * WGSL that reads one capture at a pixel position as a premultiplied colour:
 * the four texels around it, each premultiplied, weighted bilinearly. A texel
 * outside the capture is transparent.
 */
function premultipliedCaptureReadWgsl(name: string, texture: string, pixel: string): string {
	const tap = (dx: number, dy: number): string => /* wgsl */ `
		{
			let coord = ${name}Base + vec2i(${dx}, ${dy});
			let weight = ${dx === 0 ? `(1.0 - ${name}Part.x)` : `${name}Part.x`} * ${dy === 0 ? `(1.0 - ${name}Part.y)` : `${name}Part.y`};
			if (coord.x >= 0 && coord.y >= 0 && coord.x < ${name}Size.x && coord.y < ${name}Size.y) {
				let texel = textureLoad(${texture}, coord, 0);
				${name} = ${name} + vec4f(texel.rgb * texel.a, texel.a) * weight;
			}
		}`;
	return /* wgsl */ `
		let ${name}Size = vec2i(textureDimensions(${texture}));
		let ${name}Texel = ${pixel} - vec2f(0.5);
		let ${name}Floor = floor(${name}Texel);
		let ${name}Base = vec2i(${name}Floor);
		let ${name}Part = ${name}Texel - ${name}Floor;
		var ${name} = vec4f(0.0);
		${tap(0, 0)}${tap(1, 0)}${tap(0, 1)}${tap(1, 1)}
	`;
}

const quadFragmentFn = tgpu['~unstable'].fragmentFn({
	in: { uv: d.vec2f },
	out: d.vec4f
}) /* wgsl */ `{
		let quadBox = layout.$.uniforms.quadBox;
		let fromBox = layout.$.uniforms.fromBox;
		let toBox = layout.$.uniforms.toBox;
		let turns = layout.$.uniforms.turnsAndMix;
		// A box with no area has no place to look anything up in.
		if (quadBox.z < 0.5 || quadBox.w < 0.5) {
			return vec4f(0.0);
		}
		// This pixel in the quad's own box: (0, 0) at its centre, ±0.5 at its edges.
		let offset = in.uv * layout.$.uniforms.resolution - quadBox.xy;
		let quadCos = cos(turns.x);
		let quadSin = sin(turns.x);
		let place = vec2f(
			quadCos * offset.x + quadSin * offset.y,
			-quadSin * offset.x + quadCos * offset.y
		) / quadBox.zw;
		// The same place of the element's box in each Scene's capture.
		let fromReach = place * fromBox.zw;
		let fromPixel = fromBox.xy + vec2f(
			cos(turns.y) * fromReach.x - sin(turns.y) * fromReach.y,
			sin(turns.y) * fromReach.x + cos(turns.y) * fromReach.y
		);
		let toReach = place * toBox.zw;
		let toPixel = toBox.xy + vec2f(
			cos(turns.z) * toReach.x - sin(turns.z) * toReach.y,
			sin(turns.z) * toReach.x + cos(turns.z) * toReach.y
		);
		${premultipliedCaptureReadWgsl('fromColor', 'layout.$.fromTexture', 'fromPixel')}
		${premultipliedCaptureReadWgsl('toColor', 'layout.$.toTexture', 'toPixel')}
		return mix(fromColor, toColor, clamp(turns.w, 0.0, 1.0));
	}`.$uses({ layout: quadLayout });

/** Premultiplied source-over: the quad's colour is already multiplied by its alpha. */
const PREMULTIPLIED_SOURCE_OVER: GPUBlendState = {
	color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
	alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
};

export interface FilmMagicMoveQuadDraw {
	/** Which pair of the boundary this is, from 0: each keeps its own uniforms. */
	pairIndex: number;
	/** The outgoing Scene's capture of the element. */
	fromTexture: GPUTexture;
	/** The incoming Scene's capture of the element. */
	toTexture: GPUTexture;
	quad: FilmMagicMoveQuad;
	/** The frame the quad is drawn over. What it already holds is kept. */
	outputView: GPUTextureView;
	canvasWidth: number;
	canvasHeight: number;
}

export interface CompiledFilmMagicMoveQuadPass {
	draw(request: FilmMagicMoveQuadDraw): void;
}

function boxOf(rect: OrientedRectPx): [number, number, number, number] {
	return [rect.centerX, rect.centerY, rect.width, rect.height];
}

function radians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/** Compile the magic-move quad pass for the host's canvas format. */
export function compileFilmMagicMoveQuadPass(host: GpuHost): CompiledFilmMagicMoveQuadPass {
	const { format, root } = host;
	const pipeline = root['~unstable']
		.withVertex(fullScreenVertexFn, {})
		.withFragment(quadFragmentFn, { format, blend: PREMULTIPLIED_SOURCE_OVER })
		.createPipeline();
	// One uniform buffer per pair: every quad of a frame is drawn before the
	// frame is presented, and each must keep the values it was drawn with.
	const createUniformBuffer = () =>
		root
			.createBuffer(FilmMagicMoveQuadUniforms, {
				quadBox: d.vec4f(0, 0, 0, 0),
				fromBox: d.vec4f(0, 0, 0, 0),
				toBox: d.vec4f(0, 0, 0, 0),
				turnsAndMix: d.vec4f(0, 0, 0, 0),
				resolution: d.vec2f(1, 1)
			})
			.$usage('uniform');
	const uniformBuffers: ReturnType<typeof createUniformBuffer>[] = [];

	return {
		draw({ pairIndex, fromTexture, toTexture, quad, outputView, canvasWidth, canvasHeight }) {
			const uniformBuffer = (uniformBuffers[pairIndex] ??= createUniformBuffer());
			uniformBuffer.write({
				quadBox: d.vec4f(...boxOf(quad.rect)),
				fromBox: d.vec4f(...boxOf(quad.from)),
				toBox: d.vec4f(...boxOf(quad.to)),
				turnsAndMix: d.vec4f(
					radians(quad.rect.rotationDegrees),
					radians(quad.from.rotationDegrees),
					radians(quad.to.rotationDegrees),
					quad.mix
				),
				resolution: d.vec2f(canvasWidth, canvasHeight)
			});
			const bindGroup = root.createBindGroup(quadLayout, {
				fromTexture: fromTexture.createView(),
				toTexture: toTexture.createView(),
				uniforms: uniformBuffer
			});
			pipeline
				.with(bindGroup)
				.withColorAttachment({
					view: outputView,
					loadOp: 'load',
					storeOp: 'store'
				})
				.draw(3);
		}
	};
}
