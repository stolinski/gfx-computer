import tgpu, { d } from 'typegpu';

import type { GpuHost } from '$lib/platform/gpu-host';
import type {
	TransitionEffectPackContext,
	TransitionEffectRenderer
} from '$lib/platform/pipelines/types';
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

export interface TransitionEffectApplyOptions {
	fromView: GPUTextureView;
	toView: GPUTextureView;
	outputView: GPUTextureView;
	params: unknown;
	context: TransitionEffectPackContext;
}

export interface CompiledTransitionEffect {
	apply(options: TransitionEffectApplyOptions): void;
	dispose?(): void;
}

interface UniformBufferShape {
	write(value: unknown): void;
}

function compileTypedTransitionEffect<TParams>(
	host: GpuHost,
	renderer: TransitionEffectRenderer<TParams>
): CompiledTransitionEffect {
	const { format, root } = host;
	const bindGroupLayout = tgpu.bindGroupLayout({
		fromTexture: { texture: d.texture2d(d.f32) },
		toTexture: { texture: d.texture2d(d.f32) },
		samp: { sampler: 'filtering' },
		uniforms: { uniform: renderer.pass.paramsStruct as never }
	});

	const fragmentFn = tgpu['~unstable'].fragmentFn({
		in: { uv: d.vec2f },
		out: d.vec4f
	}) /* wgsl */ `{
			let fromSample = textureSample(layout.$.fromTexture, layout.$.samp, in.uv);
			let toSample = textureSample(layout.$.toTexture, layout.$.samp, in.uv);
			let transitionProgress = clamp(layout.$.uniforms.progress, 0.0, 1.0);
			if (transitionProgress <= 0.0) { return fromSample; }
			if (transitionProgress >= 1.0) { return toSample; }
			${renderer.pass.fragmentBody}
		}`.$uses({ layout: bindGroupLayout });

	const pipeline = root['~unstable']
		.withVertex(fullScreenVertexFn, {})
		.withFragment(fragmentFn, { format })
		.createPipeline();
	const sampler = root['~unstable'].createSampler({
		magFilter: 'linear',
		minFilter: 'linear',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge'
	});
	const uniformBuffer = (
		root.createBuffer(renderer.pass.paramsStruct as never) as unknown as {
			$usage: (kind: 'uniform') => UniformBufferShape;
		}
	).$usage('uniform');

	return {
		apply({ fromView, toView, outputView, params, context }) {
			const parsed = renderer.paramsSchema.parse(params);
			uniformBuffer.write(renderer.pass.pack(parsed, context));
			const bindGroup = root.createBindGroup(bindGroupLayout, {
				fromTexture: fromView,
				toTexture: toView,
				samp: sampler,
				uniforms: uniformBuffer
			} as never);
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
	};
}

export function compileTransitionEffect(
	host: GpuHost,
	renderer: TransitionEffectRenderer<unknown>
): CompiledTransitionEffect {
	return compileTypedTransitionEffect(host, renderer);
}
