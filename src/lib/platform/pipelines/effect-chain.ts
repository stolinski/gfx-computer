import tgpu, { d } from 'typegpu';

import type { Effect } from '$lib/platform/engine-schema';
import { INTERMEDIATE_FORMAT, type GpuHost } from '$lib/platform/gpu-host';
import type { PreparedVideoUnderlayTexture } from '$lib/platform/video-underlay-frame-texture';
import { requireLoadedEffectRenderer } from './runtime-loader';
import { compilePassComposite, type CompiledPassComposite } from './pass-composite';
import { resolvePassExecution, type PassPixelBounds } from './pass-execution';
import type { EffectRenderer } from './types';

const TEXTURE_USAGE_COPY_DST = 0x02;
const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const TEXTURE_USAGE_COPY_SRC = 0x01;
const INTERMEDIATE_TEXTURE_USAGE =
	TEXTURE_USAGE_TEXTURE_BINDING |
	TEXTURE_USAGE_COPY_DST |
	TEXTURE_USAGE_COPY_SRC |
	TEXTURE_USAGE_RENDER_ATTACHMENT;

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
	return Out(
		vec4f(positions[in.vertexIndex], 0.0, 1.0),
		uvs[in.vertexIndex]
	);
}`;

// Present pipeline: the final pass of every frame. Reads the last rgba16float
// intermediate and writes to the 8-bit canvas, applying ordered dither at the
// quantization boundary so smooth gradients don't band. Also the no-effect
// path (replaces the old plain blit) — the surface output is always presented
// through here, so dithering happens whether or not effects are configured.
//
// `background` uniform: [r, g, b, a] premultiplied fill composited UNDER the
// surface output (OVER operator). Default [0,0,0,0] = transparent — identical
// to the old behaviour. Set to a solid colour for full-frame segment/bumpers.
const PresentUniforms = d.struct({ background: d.vec4f });

const presentBindGroupLayout = tgpu.bindGroupLayout({
	inputTexture: { texture: d.texture2d(d.f32) },
	samp: { sampler: 'filtering' },
	uniforms: { uniform: PresentUniforms }
});

const presentFragmentFn = tgpu['~unstable'].fragmentFn({
	in: { uv: d.vec2f, position: d.builtin.position },
	out: d.vec4f
}) /* wgsl */ `{
		let s = textureSample(layout.$.inputTexture, layout.$.samp, in.uv);
		let bg = layout.$.uniforms.background;
		// OVER operator (premultiplied): composite surface s over background bg.
		// When bg.a == 0 this degenerates to s — transparent default unchanged.
		let outRgb = s.rgb + (1.0 - s.a) * bg.rgb * bg.a;
		let outA   = s.a   + (1.0 - s.a) * bg.a;
		// Interleaved-gradient-noise ordered dither (~1 LSB) applied at the
		// 16float→8bit write. Breaks up banding on near-black gradients the
		// 8-bit canvas would otherwise quantize into visible steps.
		let ign = fract(52.9829189 * fract(dot(in.position.xy, vec2f(0.06711056, 0.00583715))));
		let dither = (ign - 0.5) / 255.0;
		// The canvas is premultiplied-alpha. Dither must disappear with alpha or
		// fully transparent pixels retain noisy RGB that VP9 reveals as dark halos.
		let ditheredRgb = clamp(outRgb + vec3f(dither * outA), vec3f(0.0), vec3f(outA));
		return vec4f(ditheredRgb, outA);
	}`.$uses({ layout: presentBindGroupLayout });

export interface CompiledEffect {
	type: string;
	apply(opts: {
		commandEncoder: GPUCommandEncoder;
		inputView: GPUTextureView;
		outputView: GPUTextureView;
		params: unknown;
		progress: number;
		timestamp: number;
		canvasWidth: number;
		canvasHeight: number;
		stageContentScale?: number;
		defer?: boolean;
		scissor?: PassPixelBounds;
	}): void;
}

interface CompiledPresent {
	apply(opts: {
		commandEncoder: GPUCommandEncoder;
		inputView: GPUTextureView;
		outputView: GPUTextureView;
		background?: [number, number, number, number];
		videoUnderlayTexture?: PreparedVideoUnderlayTexture | null;
	}): void;
	dispose(): void;
}

/**
 * One Effect's full-screen pass exactly as the chain runs it. Exported so a GPU
 * probe can measure a single pass into an rgba16float target before the
 * dithered 8-bit present (`scripts/probe-optical-vignette-gpu.ts`).
 */
export function compileEffect(host: GpuHost, renderer: EffectRenderer): CompiledEffect {
	const { device, root } = host;

	// The effect declares its uniform layout via paramsStruct (a TgpuStruct).
	// TypeScript can't carry the dynamic schema through the registry boundary,
	// so we cast through unknown into TypeGPU's bind-group layout factory.
	type LayoutDef = Parameters<typeof tgpu.bindGroupLayout>[0];
	const layoutDef: LayoutDef = {
		inputTexture: { texture: d.texture2d(d.f32) },
		samp: { sampler: 'filtering' },
		uniforms: { uniform: renderer.pass.paramsStruct as never }
	} as unknown as LayoutDef;
	const bindGroupLayout = tgpu.bindGroupLayout(layoutDef);

	const fragmentFn = tgpu['~unstable'].fragmentFn({
		in: { uv: d.vec2f },
		out: d.vec4f
	}) /* wgsl */ `{
			let inputSample = textureSample(layout.$.inputTexture, layout.$.samp, in.uv);
			${renderer.pass.fragmentBody}
		}`.$uses({ layout: bindGroupLayout });

	const pipeline = root['~unstable']
		.withVertex(fullScreenVertexFn, {})
		.withFragment(fragmentFn, { format: INTERMEDIATE_FORMAT })
		.createPipeline();

	const sampler = root['~unstable'].createSampler({
		magFilter: 'linear',
		minFilter: 'linear',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge'
	});

	// A persistent uniform buffer per compiled effect; values rewritten per
	// frame via renderer.pass.pack(params). TypeGPU's type machinery doesn't
	// carry the generic struct through `paramsStruct: unknown`, so we route
	// through `as never` and access write() via a minimal local type.
	interface UniformBufferShape {
		write(value: unknown): void;
	}
	const uniformBuffer = (
		root.createBuffer(renderer.pass.paramsStruct as never) as unknown as {
			$usage: (kind: 'uniform') => UniformBufferShape;
		}
	).$usage('uniform');

	return {
		type: renderer.type,
		apply({
			commandEncoder,
			inputView,
			outputView,
			params,
			progress,
			timestamp,
			canvasWidth,
			canvasHeight,
			stageContentScale,
			defer,
			scissor
		}) {
			uniformBuffer.write(
				renderer.pass.pack(params, {
					progress,
					timestamp,
					canvasWidth,
					canvasHeight,
					stageContentScale
				}) as never
			);

			const bindGroup = root.createBindGroup(bindGroupLayout, {
				inputTexture: inputView,
				samp: sampler,
				uniforms: uniformBuffer
			} as never);

			if (defer) {
				const renderPass = commandEncoder.beginRenderPass({
					colorAttachments: [
						{
							view: outputView,
							clearValue: [0, 0, 0, 0],
							loadOp: 'clear',
							storeOp: 'store'
						}
					]
				});
				if (scissor) {
					renderPass.setScissorRect(scissor.x, scissor.y, scissor.width, scissor.height);
				}
				pipeline.with(bindGroup).with(renderPass).draw(3);
				renderPass.end();
			} else {
				pipeline
					.with(bindGroup)
					.withColorAttachment({
						view: outputView,
						clearValue: [0, 0, 0, 0],
						loadOp: 'clear',
						storeOp: 'store'
					})
					.draw(3);
			}

			// device used implicitly by pipeline; nothing else to do per apply.
			void device;
		}
	};
}

// Background-composite pass: the SAME OVER operator as the present pass, but
// targeting an rgba16float intermediate instead of the 8-bit canvas. Used to
// bake a full-frame `backgroundFill` UNDER the content BEFORE the effect chain,
// so content-masked effects (e.g. paper-grain, whose mask is `step(0.001, a)`)
// animate the whole opaque frame and the hold breathes — instead of the fill
// being added only at the final present pass, leaving the background static.
// Only used when a fill is declared AND effects exist; transparent pieces and
// effectless full-frame pieces never hit this path.
function compileBackgroundComposite(host: GpuHost): CompiledPresent {
	const { root } = host;

	const pipeline = root['~unstable']
		.withVertex(fullScreenVertexFn, {})
		.withFragment(presentFragmentFn, { format: INTERMEDIATE_FORMAT })
		.createPipeline();

	const sampler = root['~unstable'].createSampler({
		magFilter: 'linear',
		minFilter: 'linear',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge'
	});

	const uniformBuffer = root
		.createBuffer(PresentUniforms, { background: d.vec4f(0, 0, 0, 0) })
		.$usage('uniform');

	return {
		apply({ inputView, outputView, background }) {
			const [r, g, b, a] = background ?? [0, 0, 0, 0];
			uniformBuffer.write({ background: d.vec4f(r, g, b, a) });

			const bindGroup = root.createBindGroup(presentBindGroupLayout, {
				inputTexture: inputView,
				samp: sampler,
				uniforms: uniformBuffer
			});

			pipeline
				.with(bindGroup)
				.withColorAttachment({
					view: outputView,
					clearValue: [0, 0, 0, 0],
					loadOp: 'clear',
					storeOp: 'store'
				})
				.draw(3);
		},
		dispose: () => undefined
	};
}

function compilePresent(host: GpuHost): CompiledPresent {
	// Targets the canvas format (8-bit) — this is the only pass that writes the
	// final 8-bit output; everything upstream is rgba16float.
	const { format, root } = host;
	const FinalPresentUniforms = d.struct({
		background: d.vec4f,
		canvasSize: d.vec2f,
		videoUnderlayDisplaySize: d.vec2f,
		videoUnderlayRotation: d.f32,
		videoUnderlayEnabled: d.f32
	});
	const finalPresentBindGroupLayout = tgpu.bindGroupLayout({
		inputTexture: { texture: d.texture2d(d.f32) },
		videoUnderlayTexture: { texture: d.texture2d(d.f32) },
		samp: { sampler: 'filtering' },
		uniforms: { uniform: FinalPresentUniforms }
	});
	const finalPresentFragmentFn = tgpu['~unstable'].fragmentFn({
		in: { uv: d.vec2f, position: d.builtin.position },
		out: d.vec4f
	}) /* wgsl */ `{
			let s = textureSample(layout.$.inputTexture, layout.$.samp, in.uv);
			let underlayDisplaySize = layout.$.uniforms.videoUnderlayDisplaySize;
			let underlayAspect = underlayDisplaySize.x / max(1.0, underlayDisplaySize.y);
			let canvasSize = layout.$.uniforms.canvasSize;
			let canvasAspect = canvasSize.x / max(1.0, canvasSize.y);
			let cropWidth = min(1.0, canvasAspect / underlayAspect);
			let cropHeight = min(1.0, underlayAspect / canvasAspect);
			let underlayUv = vec2f(
				0.5 + (in.uv.x - 0.5) * cropWidth,
				0.5 + (in.uv.y - 0.5) * cropHeight
			);
			let rotation = layout.$.uniforms.videoUnderlayRotation;
			let uv0 = underlayUv;
			let uv90 = vec2f(underlayUv.y, 1.0 - underlayUv.x);
			let uv180 = vec2f(1.0 - underlayUv.x, 1.0 - underlayUv.y);
			let uv270 = vec2f(1.0 - underlayUv.y, underlayUv.x);
			let is0 = select(0.0, 1.0, rotation < 0.5);
			let is90 = select(0.0, 1.0, rotation >= 0.5 && rotation < 1.5);
			let is180 = select(0.0, 1.0, rotation >= 1.5 && rotation < 2.5);
			let is270 = select(0.0, 1.0, rotation >= 2.5);
			let rawUv = uv0 * is0 + uv90 * is90 + uv180 * is180 + uv270 * is270;
			let underlaySample = textureSample(
				layout.$.videoUnderlayTexture,
				layout.$.samp,
				clamp(rawUv, vec2f(0.0), vec2f(1.0))
			);
			let underlayEnabled = layout.$.uniforms.videoUnderlayEnabled;
			let bg = layout.$.uniforms.background;
			let underRgb = mix(bg.rgb * bg.a, underlaySample.rgb, underlayEnabled);
			let underA = mix(bg.a, underlaySample.a, underlayEnabled);
			let outRgb = s.rgb + (1.0 - s.a) * underRgb;
			let outA = s.a + (1.0 - s.a) * underA;
			let ign = fract(52.9829189 * fract(dot(in.position.xy, vec2f(0.06711056, 0.00583715))));
			let dither = (ign - 0.5) / 255.0;
			let ditheredRgb = clamp(outRgb + vec3f(dither * outA), vec3f(0.0), vec3f(outA));
			return vec4f(ditheredRgb, outA);
		}`.$uses({ layout: finalPresentBindGroupLayout });

	const pipeline = root['~unstable']
		.withVertex(fullScreenVertexFn, {})
		.withFragment(finalPresentFragmentFn, { format })
		.createPipeline();

	const sampler = root['~unstable'].createSampler({
		magFilter: 'linear',
		minFilter: 'linear',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge'
	});

	const uniformBuffer = root
		.createBuffer(FinalPresentUniforms, {
			background: d.vec4f(0, 0, 0, 0),
			canvasSize: d.vec2f(host.canvas.width, host.canvas.height),
			videoUnderlayDisplaySize: d.vec2f(1, 1),
			videoUnderlayRotation: 0,
			videoUnderlayEnabled: 0
		})
		.$usage('uniform');
	const transparentTexture = host.device.createTexture({
		size: [1, 1, 1],
		format: 'rgba8unorm',
		usage: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_COPY_DST
	});
	host.device.queue.writeTexture(
		{ texture: transparentTexture },
		new Uint8Array([0, 0, 0, 0]),
		{ bytesPerRow: 4 },
		{ width: 1, height: 1, depthOrArrayLayers: 1 }
	);

	return {
		apply({ inputView, outputView, background, videoUnderlayTexture }) {
			const [r, g, b, a] = background ?? [0, 0, 0, 0];
			uniformBuffer.write({
				background: d.vec4f(r, g, b, a),
				canvasSize: d.vec2f(host.canvas.width, host.canvas.height),
				videoUnderlayDisplaySize: d.vec2f(
					videoUnderlayTexture?.displayWidth ?? 1,
					videoUnderlayTexture?.displayHeight ?? 1
				),
				videoUnderlayRotation: videoUnderlayTexture ? videoUnderlayTexture.rotation / 90 : 0,
				videoUnderlayEnabled: videoUnderlayTexture ? 1 : 0
			});

			const bindGroup = root.createBindGroup(finalPresentBindGroupLayout, {
				inputTexture: inputView,
				videoUnderlayTexture: videoUnderlayTexture?.texture ?? transparentTexture,
				samp: sampler,
				uniforms: uniformBuffer
			});

			pipeline
				.with(bindGroup)
				.withColorAttachment({
					view: outputView,
					clearValue: [0, 0, 0, 0],
					loadOp: 'clear',
					storeOp: 'store'
				})
				.draw(3);
		},
		dispose: () => transparentTexture.destroy()
	};
}

export interface EffectChainOptions {
	host: GpuHost;
	width: number;
	height: number;
}

export interface ApplyChainOptions {
	commandEncoder: GPUCommandEncoder;
	effects: readonly Effect[];
	inputTexture: GPUTexture;
	outputView: GPUTextureView;
	// Timeline-driven values forwarded to each effect's `pack(params, ctx)` so
	// time-driven shaders animate deterministically. Both derive from the same
	// paused-timeline scrub; preview and export agree at the same time.
	progress: number;
	timestamp: number;
	/** Depth-stage Surface-plane magnification this frame (see EffectPackContext). */
	stageContentScale?: number;
	/** Premultiplied RGBA fill composited under the surface output. Absent = transparent default. */
	background?: [number, number, number, number];
	/** Decoded creator footage composited beneath the processed GFX result in the final pass. */
	videoUnderlayTexture?: PreparedVideoUnderlayTexture | null;
}

export class EffectChain {
	#host: GpuHost;
	#width: number;
	#height: number;
	#pingTexture: GPUTexture;
	#pongTexture: GPUTexture;
	#present: CompiledPresent;
	#backgroundComposite: CompiledPresent;
	#cache: Map<string, CompiledEffect>;
	#composite: CompiledPassComposite;
	#scratchTextures = new Map<string, GPUTexture>();

	constructor({ host, width, height }: EffectChainOptions) {
		this.#host = host;
		this.#width = width;
		this.#height = height;
		this.#present = compilePresent(host);
		this.#backgroundComposite = compileBackgroundComposite(host);
		this.#cache = new Map();
		this.#composite = compilePassComposite(host);

		const descriptor: GPUTextureDescriptor = {
			size: [width, height, 1],
			format: INTERMEDIATE_FORMAT,
			usage: INTERMEDIATE_TEXTURE_USAGE
		};
		this.#pingTexture = host.device.createTexture(descriptor);
		this.#pongTexture = host.device.createTexture(descriptor);
	}

	#scratchTexture(width: number, height: number): GPUTexture {
		const key = `${width}x${height}`;
		const existing = this.#scratchTextures.get(key);
		if (existing) return existing;
		const texture = this.#host.device.createTexture({
			size: [width, height, 1],
			format: INTERMEDIATE_FORMAT,
			usage: INTERMEDIATE_TEXTURE_USAGE
		});
		this.#scratchTextures.set(key, texture);
		return texture;
	}

	#getCompiled(type: string): CompiledEffect {
		const cached = this.#cache.get(type);
		if (cached) {
			return cached;
		}

		const renderer = requireLoadedEffectRenderer(type);
		const compiled = compileEffect(this.#host, renderer);
		this.#cache.set(type, compiled);
		return compiled;
	}

	// Apply effects in sequence, ping-ponging between intermediate textures.
	// The final pass writes to `outputView`.
	apply({
		commandEncoder,
		effects,
		inputTexture,
		outputView,
		progress,
		timestamp,
		stageContentScale,
		background,
		videoUnderlayTexture
	}: ApplyChainOptions): void {
		const valid = effects.map((effect) => ({
			effect,
			compiled: this.#getCompiled(effect.type)
		}));

		// Full-frame fill baked BEFORE the effects: when a `backgroundFill` is
		// declared (background.a > 0) AND effects run, composite the content over
		// the fill into the first intermediate so the effects operate on the whole
		// opaque frame (content-masked effects like paper-grain then animate the
		// background too — the hold breathes). The present pass below then skips
		// the fill (already baked). Transparent pieces (a == 0) and effectless
		// full-frame pieces never take this branch — their path is unchanged.
		const preCompositeFill = (background?.[3] ?? 0) > 0 && valid.length > 0;
		let currentInputView = inputTexture.createView();
		let parity = 0;
		if (preCompositeFill) {
			this.#backgroundComposite.apply({
				commandEncoder,
				inputView: inputTexture.createView(),
				outputView: this.#pingTexture.createView(),
				background
			});
			currentInputView = this.#pingTexture.createView();
			parity = 1; // first effect must write pong (ping now holds the baked frame)
		}

		// Run every effect into the rgba16float intermediates, then present the
		// final result to the 8-bit canvas with dither. The no-effect path skips
		// the loop and presents the surface output directly — dithering (and the
		// 16float→8bit conversion) happens either way.
		for (let i = 0; i < valid.length; i += 1) {
			const outputTexture = (i + parity) % 2 === 0 ? this.#pingTexture : this.#pongTexture;
			const renderer = requireLoadedEffectRenderer(valid[i].effect.type);
			const context = {
				progress,
				timestamp,
				canvasWidth: this.#width,
				canvasHeight: this.#height,
				stageContentScale
			};
			const execution = resolvePassExecution(
				renderer.pass.execution?.(valid[i].effect.params, context),
				this.#width,
				this.#height
			);
			if (execution.mode === 'full') {
				valid[i].compiled.apply({
					commandEncoder,
					inputView: currentInputView,
					outputView: outputTexture.createView(),
					params: valid[i].effect.params,
					...context
				});
			} else {
				const localEncoder = this.#host.device.createCommandEncoder();
				const scratchTexture = this.#scratchTexture(execution.targetWidth, execution.targetHeight);
				valid[i].compiled.apply({
					commandEncoder: localEncoder,
					inputView: currentInputView,
					outputView: scratchTexture.createView(),
					params: valid[i].effect.params,
					...context,
					defer: true,
					scissor: execution.mode === 'region' ? execution.region : undefined
				});
				this.#composite.apply({
					commandEncoder: localEncoder,
					inputView: currentInputView,
					processedView: scratchTexture.createView(),
					outputView: outputTexture.createView(),
					region: execution.region,
					canvasWidth: this.#width,
					canvasHeight: this.#height
				});
				this.#host.device.queue.submit([localEncoder.finish()]);
			}
			currentInputView = outputTexture.createView();
		}

		this.#present.apply({
			commandEncoder,
			inputView: currentInputView,
			outputView,
			// The fill is pre-composited under the content BEFORE the chain (so
			// content-masked effects animate the whole opaque frame) and passed
			// again here as the present backstop. The OVER operator makes the second
			// application a no-op wherever the chain output is already opaque; where
			// an effect carved alpha out (e.g. a pane-edge fade window), the fill
			// shows through — a declared-backgroundFill piece stays opaque to its
			// edges. Transparent pieces (background absent / a=0) are unaffected.
			background,
			videoUnderlayTexture
		});
	}

	dispose(): void {
		this.#pingTexture.destroy();
		this.#pongTexture.destroy();
		this.#present.dispose();
		this.#backgroundComposite.dispose();
		for (const texture of this.#scratchTextures.values()) texture.destroy();
		this.#scratchTextures.clear();
		this.#cache.clear();
	}
}
