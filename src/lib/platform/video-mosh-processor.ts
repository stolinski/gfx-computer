/**
 * The GPU half of a Mosh window (ADR-0065): resolve footage into native
 * target space, reduce it to quarter-resolution integer luma, search block
 * motion, decode the next live frame onto the held frame, and heal. Every
 * pass mirrors `video-mosh-reference.ts`, which is the specification;
 * `scripts/probe-video-mosh-gpu.ts` holds the two to each other.
 *
 * The processor owns its textures and is stateful: `begin` holds a frame,
 * and each `step` advances one frame of the window. Seeking, replay, and
 * when to begin are the runtime's job (`video-underlay-runtime-controller.ts`).
 */
import type { VideoMoshWindow } from './engine-schema';
import { INTERMEDIATE_FORMAT } from './gpu-host';
import { videoUnderlayCoverUvWgsl } from './pipelines/video-underlay-cover-wgsl';
import {
	resolveVideoMoshCorruptionThreshold,
	resolveVideoMoshHealWeight,
	VIDEO_MOSH_COARSE_STEP,
	VIDEO_MOSH_LUMA_SCALE,
	VIDEO_MOSH_REFINE_RADIUS,
	VIDEO_MOSH_SEARCH_RADIUS
} from './video-mosh-reference';

/** A decoded footage frame and how the final present frames it. */
export interface VideoMoshSourceFrame {
	texture: GPUTexture;
	displayWidth: number;
	displayHeight: number;
	rotation: 0 | 90 | 180 | 270;
}

const TEXTURE_BINDING = 0x04;
const COPY_SRC = 0x01;
const COPY_DST = 0x02;
const RENDER_ATTACHMENT = 0x10;
const STORAGE_BINDING = 0x08;
const BUFFER_STORAGE = 0x80;
const BUFFER_COPY_SRC = 0x04;
const BUFFER_COPY_DST = 0x08;
const BUFFER_UNIFORM = 0x40;

const LIVE_USAGE = TEXTURE_BINDING | COPY_SRC | COPY_DST | RENDER_ATTACHMENT;
const HELD_USAGE = TEXTURE_BINDING | COPY_SRC | COPY_DST | STORAGE_BINDING;

const HASH_WGSL = /* wgsl */ `
fn moshHash(value: u32) -> u32 {
	let state = value * 747796405u + 2891336453u;
	let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}`;

const RESOLVE_WGSL = /* wgsl */ `
struct ResolveUniforms { displaySize: vec2f, canvasSize: vec2f, rotation: f32 }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> uniforms: ResolveUniforms;

struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f }

@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
	var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	var uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
	return VertexOut(vec4f(positions[index], 0.0, 1.0), uvs[index]);
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
	${videoUnderlayCoverUvWgsl({
		uv: 'input.uv',
		displaySize: 'uniforms.displaySize',
		canvasSize: 'uniforms.canvasSize',
		rotation: 'uniforms.rotation'
	})}
	return textureSample(source, samp, clamp(rawUv, vec2f(0.0), vec2f(1.0)));
}`;

const LUMA_WGSL = /* wgsl */ `
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> luma: array<u32>;
@group(0) @binding(2) var<uniform> size: vec4u; // target width, height, luma width, luma height

fn toByte(value: f32) -> u32 {
	return u32(clamp(floor(value * 255.0 + 0.5), 0.0, 255.0));
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= size.z || id.y >= size.w) { return; }
	var sum = 0u;
	for (var y = 0u; y < ${VIDEO_MOSH_LUMA_SCALE}u; y++) {
		for (var x = 0u; x < ${VIDEO_MOSH_LUMA_SCALE}u; x++) {
			let px = id.x * ${VIDEO_MOSH_LUMA_SCALE}u + x;
			let py = id.y * ${VIDEO_MOSH_LUMA_SCALE}u + y;
			if (px < size.x && py < size.y) {
				let color = textureLoad(frame, vec2u(px, py), 0);
				sum += (54u * toByte(color.r) + 183u * toByte(color.g) + 19u * toByte(color.b) + 128u) >> 8u;
			}
		}
	}
	luma[id.y * size.z + id.x] = sum;
}`;

const SEARCH_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> live: array<u32>;
@group(0) @binding(1) var<storage, read> previous: array<u32>;
@group(0) @binding(2) var<storage, read_write> vectors: array<i32>;
@group(0) @binding(3) var<uniform> grid: vec4u; // luma width, luma height, block quarter size, columns

fn previousAt(x: i32, y: i32) -> u32 {
	let cx = clamp(x, 0, i32(grid.x) - 1);
	let cy = clamp(y, 0, i32(grid.y) - 1);
	return previous[u32(cy) * grid.x + u32(cx)];
}

fn blockCost(x0: u32, y0: u32, x1: u32, y1: u32, d: vec2i) -> u32 {
	var cost = 0u;
	for (var y = y0; y < y1; y++) {
		for (var x = x0; x < x1; x++) {
			let a = live[y * grid.x + x];
			let b = previousAt(i32(x) - d.x, i32(y) - d.y);
			cost += select(b - a, a - b, a > b);
		}
	}
	return cost;
}

@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
	let rows = (grid.y + grid.z - 1u) / grid.z;
	if (id.x >= grid.w * rows) { return; }
	let column = id.x % grid.w;
	let row = id.x / grid.w;
	let x0 = column * grid.z;
	let y0 = row * grid.z;
	let x1 = min(grid.x, x0 + grid.z);
	let y1 = min(grid.y, y0 + grid.z);
	var coarse = vec2i(0, 0);
	{
		var bestCost = 0xffffffffu;
		var bestLength = 0x7fffffff;
		for (var j = -${VIDEO_MOSH_SEARCH_RADIUS / VIDEO_MOSH_COARSE_STEP}; j <= ${VIDEO_MOSH_SEARCH_RADIUS / VIDEO_MOSH_COARSE_STEP}; j++) {
			for (var i = -${VIDEO_MOSH_SEARCH_RADIUS / VIDEO_MOSH_COARSE_STEP}; i <= ${VIDEO_MOSH_SEARCH_RADIUS / VIDEO_MOSH_COARSE_STEP}; i++) {
				let d = vec2i(i, j) * ${VIDEO_MOSH_COARSE_STEP};
				let cost = blockCost(x0, y0, x1, y1, d);
				let length = d.x * d.x + d.y * d.y;
				if (cost < bestCost || (cost == bestCost && length < bestLength)) {
					bestCost = cost;
					bestLength = length;
					coarse = d;
				}
			}
		}
	}
	var best = coarse;
	{
		var bestCost = 0xffffffffu;
		var bestLength = 0x7fffffff;
		for (var j = -${VIDEO_MOSH_REFINE_RADIUS}; j <= ${VIDEO_MOSH_REFINE_RADIUS}; j++) {
			for (var i = -${VIDEO_MOSH_REFINE_RADIUS}; i <= ${VIDEO_MOSH_REFINE_RADIUS}; i++) {
				let d = coarse + vec2i(i, j);
				let cost = blockCost(x0, y0, x1, y1, d);
				let length = d.x * d.x + d.y * d.y;
				if (cost < bestCost || (cost == bestCost && length < bestLength)) {
					bestCost = cost;
					bestLength = length;
					best = d;
				}
			}
		}
	}
	vectors[id.x * 2u] = best.x * ${VIDEO_MOSH_LUMA_SCALE};
	vectors[id.x * 2u + 1u] = best.y * ${VIDEO_MOSH_LUMA_SCALE};
}`;

const STEP_WGSL = /* wgsl */ `
struct StepUniforms {
	size: vec2u,
	blockSize: u32,
	columns: u32,
	seed: u32,
	frame: u32,
	corruptionThreshold: u32,
	bleed: f32,
}
@group(0) @binding(0) var held: texture_2d<f32>;
@group(0) @binding(1) var live: texture_2d<f32>;
@group(0) @binding(2) var previous: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> vectors: array<i32>;
@group(0) @binding(4) var<storage, read> lagVectors: array<i32>;
@group(0) @binding(5) var next: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var<uniform> uniforms: StepUniforms;
${HASH_WGSL}

fn loadClamped(texture: texture_2d<f32>, x: i32, y: i32) -> vec4f {
	let cx = clamp(x, 0, i32(uniforms.size.x) - 1);
	let cy = clamp(y, 0, i32(uniforms.size.y) - 1);
	return textureLoad(texture, vec2i(cx, cy), 0);
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= uniforms.size.x || id.y >= uniforms.size.y) { return; }
	let column = id.x / uniforms.blockSize;
	let row = id.y / uniforms.blockSize;
	let block = (row * uniforms.columns + column) * 2u;
	let first = moshHash(uniforms.seed ^ moshHash(column ^ moshHash(row ^ moshHash(uniforms.frame))));
	let corrupted = first < uniforms.corruptionThreshold;
	let kind = moshHash(first) % 3u;
	if (corrupted && kind == 0u) {
		textureStore(next, id.xy, textureLoad(held, id.xy, 0));
		return;
	}
	var d = vec2i(vectors[block], vectors[block + 1u]);
	if (corrupted && kind == 1u) {
		d = vec2i(lagVectors[block], lagVectors[block + 1u]);
	} else if (corrupted && kind == 2u) {
		d = d * 2;
	}
	let x = i32(id.x);
	let y = i32(id.y);
	let reference = loadClamped(held, x - d.x, y - d.y);
	let residual = textureLoad(live, id.xy, 0) - loadClamped(previous, x - d.x, y - d.y);
	let decoded = reference + uniforms.bleed * residual;
	let alpha = clamp(decoded.a, 0.0, 1.0);
	textureStore(next, id.xy, vec4f(clamp(decoded.rgb, vec3f(0.0), vec3f(alpha)), alpha));
}`;

const HEAL_WGSL = /* wgsl */ `
@group(0) @binding(0) var held: texture_2d<f32>;
@group(0) @binding(1) var live: texture_2d<f32>;
@group(0) @binding(2) var output: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> weight: vec4f;

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
	let size = textureDimensions(held);
	if (id.x >= size.x || id.y >= size.y) { return; }
	let a = textureLoad(held, id.xy, 0);
	let b = textureLoad(live, id.xy, 0);
	textureStore(output, id.xy, a + (b - a) * weight.x);
}`;

function dispatchCount(size: number, groupSize: number): number {
	return Math.ceil(size / groupSize);
}

/** Stateful GPU processor for one Mosh window at one native target size. */
export class VideoMoshProcessor {
	readonly #device: GPUDevice;
	readonly #width: number;
	readonly #height: number;
	readonly #lumaWidth: number;
	readonly #lumaHeight: number;
	readonly #live: [GPUTexture, GPUTexture];
	readonly #held: [GPUTexture, GPUTexture];
	readonly #healed: GPUTexture;
	readonly #luma: [GPUBuffer, GPUBuffer];
	#vectors: [GPUBuffer, GPUBuffer] | null = null;
	readonly #sampler: GPUSampler;
	readonly #resolvePipeline: GPURenderPipeline;
	readonly #lumaPipeline: GPUComputePipeline;
	readonly #searchPipeline: GPUComputePipeline;
	readonly #stepPipeline: GPUComputePipeline;
	readonly #healPipeline: GPUComputePipeline;
	readonly #ownedBuffers: GPUBuffer[] = [];
	#window: VideoMoshWindow | null = null;
	#columns = 0;
	#rows = 0;
	/** Which `#live` slot holds the most recent live frame. */
	#liveSlot = 0;
	/** Which `#held` slot holds the current held frame. */
	#heldSlot = 0;
	/** Which `#vectors` slot the last step wrote. */
	#vectorSlot = 0;
	#localFrame = -1;
	#isDisposed = false;

	constructor(device: GPUDevice, width: number, height: number) {
		this.#device = device;
		this.#width = width;
		this.#height = height;
		this.#lumaWidth = Math.ceil(width / VIDEO_MOSH_LUMA_SCALE);
		this.#lumaHeight = Math.ceil(height / VIDEO_MOSH_LUMA_SCALE);
		const texture = (usage: number): GPUTexture =>
			device.createTexture({ size: [width, height, 1], format: INTERMEDIATE_FORMAT, usage });
		this.#live = [texture(LIVE_USAGE), texture(LIVE_USAGE)];
		this.#held = [texture(HELD_USAGE), texture(HELD_USAGE)];
		this.#healed = texture(HELD_USAGE);
		const lumaBytes = this.#lumaWidth * this.#lumaHeight * 4;
		this.#luma = [this.#buffer(lumaBytes), this.#buffer(lumaBytes)];
		this.#sampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
		const resolveModule = device.createShaderModule({ code: RESOLVE_WGSL });
		this.#resolvePipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: resolveModule, entryPoint: 'vertexMain' },
			fragment: {
				module: resolveModule,
				entryPoint: 'fragmentMain',
				targets: [{ format: INTERMEDIATE_FORMAT }]
			}
		});
		const compute = (code: string): GPUComputePipeline =>
			device.createComputePipeline({
				layout: 'auto',
				compute: { module: device.createShaderModule({ code }), entryPoint: 'main' }
			});
		this.#lumaPipeline = compute(LUMA_WGSL);
		this.#searchPipeline = compute(SEARCH_WGSL);
		this.#stepPipeline = compute(STEP_WGSL);
		this.#healPipeline = compute(HEAL_WGSL);
	}

	/** The window being processed, or null before the first `begin`. */
	get window(): VideoMoshWindow | null {
		return this.#window;
	}

	/** The window frame the last step produced: −1 right after `begin`. */
	get localFrame(): number {
		return this.#localFrame;
	}

	/** Hold `source` (the footage at `startFrame − 1`) and reset the window. */
	beginFromSource(window: VideoMoshWindow, source: VideoMoshSourceFrame): void {
		this.#prepareWindow(window);
		this.#resolveInto(source, this.#liveSlot);
		this.#holdLive();
	}

	/** As `beginFromSource`, for a frame already in target space at this size. */
	beginFromTarget(window: VideoMoshWindow, frame: GPUTexture): void {
		this.#prepareWindow(window);
		this.#copyInto(frame, this.#liveSlot);
		this.#holdLive();
	}

	/** Decode the next footage frame of the window; returns the target-space frame to show. */
	stepFromSource(source: VideoMoshSourceFrame): GPUTexture {
		const slot = 1 - this.#liveSlot;
		this.#resolveInto(source, slot);
		return this.#step(slot);
	}

	/** As `stepFromSource`, for a frame already in target space at this size. */
	stepFromTarget(frame: GPUTexture): GPUTexture {
		const slot = 1 - this.#liveSlot;
		this.#copyInto(frame, slot);
		return this.#step(slot);
	}

	dispose(): void {
		if (this.#isDisposed) return;
		this.#isDisposed = true;
		for (const texture of [...this.#live, ...this.#held, this.#healed]) texture.destroy();
		for (const buffer of this.#ownedBuffers) buffer.destroy();
	}

	#buffer(size: number, usage = BUFFER_STORAGE | BUFFER_COPY_SRC | BUFFER_COPY_DST): GPUBuffer {
		const buffer = this.#device.createBuffer({ size: Math.max(16, size), usage });
		this.#ownedBuffers.push(buffer);
		return buffer;
	}

	#uniform(data: ArrayBuffer): GPUBuffer {
		const buffer = this.#buffer(data.byteLength, BUFFER_UNIFORM | BUFFER_COPY_DST);
		this.#device.queue.writeBuffer(buffer, 0, data);
		return buffer;
	}

	#prepareWindow(window: VideoMoshWindow): void {
		if (this.#isDisposed) throw new Error('The Mosh window processor was disposed.');
		const blockQuarter = window.blockSize / VIDEO_MOSH_LUMA_SCALE;
		const columns = Math.ceil(this.#lumaWidth / blockQuarter);
		const rows = Math.ceil(this.#lumaHeight / blockQuarter);
		if (!this.#vectors || columns !== this.#columns || rows !== this.#rows) {
			const bytes = columns * rows * 8;
			this.#vectors = [this.#buffer(bytes), this.#buffer(bytes)];
			this.#columns = columns;
			this.#rows = rows;
		}
		// The first step's lag vectors are zero: there is no earlier step.
		const encoder = this.#device.createCommandEncoder();
		encoder.clearBuffer(this.#vectors[0]);
		encoder.clearBuffer(this.#vectors[1]);
		this.#device.queue.submit([encoder.finish()]);
		this.#window = window;
		this.#vectorSlot = 1;
		this.#localFrame = -1;
		this.#releaseFrameUniforms();
	}

	#resolveInto(source: VideoMoshSourceFrame, slot: number): void {
		const uniforms = new Float32Array([
			source.displayWidth,
			source.displayHeight,
			this.#width,
			this.#height,
			source.rotation / 90,
			0,
			0,
			0
		]);
		const encoder = this.#device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.#live[slot].createView(),
					clearValue: [0, 0, 0, 0],
					loadOp: 'clear',
					storeOp: 'store'
				}
			]
		});
		pass.setPipeline(this.#resolvePipeline);
		pass.setBindGroup(
			0,
			this.#device.createBindGroup({
				layout: this.#resolvePipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: source.texture.createView() },
					{ binding: 1, resource: this.#sampler },
					{ binding: 2, resource: { buffer: this.#uniform(uniforms.buffer) } }
				]
			})
		);
		pass.draw(3);
		pass.end();
		this.#device.queue.submit([encoder.finish()]);
	}

	#copyInto(frame: GPUTexture, slot: number): void {
		if (frame.width !== this.#width || frame.height !== this.#height) {
			throw new RangeError(
				`A target-space Mosh frame must be ${this.#width}×${this.#height}, got ${frame.width}×${frame.height}.`
			);
		}
		const encoder = this.#device.createCommandEncoder();
		encoder.copyTextureToTexture({ texture: frame }, { texture: this.#live[slot] }, [
			this.#width,
			this.#height,
			1
		]);
		this.#device.queue.submit([encoder.finish()]);
	}

	/** The live frame just ingested becomes the held frame and the motion reference. */
	#holdLive(): void {
		const encoder = this.#device.createCommandEncoder();
		encoder.copyTextureToTexture(
			{ texture: this.#live[this.#liveSlot] },
			{ texture: this.#held[this.#heldSlot] },
			[this.#width, this.#height, 1]
		);
		this.#encodeLuma(encoder, this.#liveSlot);
		this.#device.queue.submit([encoder.finish()]);
	}

	#encodeLuma(encoder: GPUCommandEncoder, slot: number): void {
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.#lumaPipeline);
		pass.setBindGroup(
			0,
			this.#device.createBindGroup({
				layout: this.#lumaPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: this.#live[slot].createView() },
					{ binding: 1, resource: { buffer: this.#luma[slot] } },
					{
						binding: 2,
						resource: {
							buffer: this.#uniform(
								new Uint32Array([this.#width, this.#height, this.#lumaWidth, this.#lumaHeight])
									.buffer
							)
						}
					}
				]
			})
		);
		pass.dispatchWorkgroups(dispatchCount(this.#lumaWidth, 8), dispatchCount(this.#lumaHeight, 8));
		pass.end();
	}

	#step(liveSlot: number): GPUTexture {
		const window = this.#window;
		const vectors = this.#vectors;
		if (!window || !vectors) throw new Error('Begin a Mosh window before stepping it.');
		if (this.#localFrame + 1 >= window.durationFrames) {
			throw new RangeError(`Mosh window "${window.id}" has no frame ${this.#localFrame + 1}.`);
		}
		const frame = this.#localFrame + 1;
		const previousSlot = 1 - liveSlot;
		const lagSlot = this.#vectorSlot;
		const vectorSlot = 1 - lagSlot;
		const encoder = this.#device.createCommandEncoder();
		this.#encodeLuma(encoder, liveSlot);

		if (window.motion === 'follow' || frame === 0) {
			const search = encoder.beginComputePass();
			search.setPipeline(this.#searchPipeline);
			search.setBindGroup(
				0,
				this.#device.createBindGroup({
					layout: this.#searchPipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: { buffer: this.#luma[liveSlot] } },
						{ binding: 1, resource: { buffer: this.#luma[previousSlot] } },
						{ binding: 2, resource: { buffer: vectors[vectorSlot] } },
						{
							binding: 3,
							resource: {
								buffer: this.#uniform(
									new Uint32Array([
										this.#lumaWidth,
										this.#lumaHeight,
										window.blockSize / VIDEO_MOSH_LUMA_SCALE,
										this.#columns
									]).buffer
								)
							}
						}
					]
				})
			);
			search.dispatchWorkgroups(dispatchCount(this.#columns * this.#rows, 64));
			search.end();
		} else {
			// `repeat` keeps the first step's field: carry it forward unchanged.
			encoder.copyBufferToBuffer(
				vectors[lagSlot],
				0,
				vectors[vectorSlot],
				0,
				vectors[lagSlot].size
			);
		}

		const stepUniforms = new ArrayBuffer(32);
		new Uint32Array(stepUniforms, 0, 7).set([
			this.#width,
			this.#height,
			window.blockSize,
			this.#columns,
			window.seed,
			frame,
			resolveVideoMoshCorruptionThreshold(window.corruption)
		]);
		new Float32Array(stepUniforms, 28, 1).set([window.bleed]);
		const nextHeldSlot = 1 - this.#heldSlot;
		const step = encoder.beginComputePass();
		step.setPipeline(this.#stepPipeline);
		step.setBindGroup(
			0,
			this.#device.createBindGroup({
				layout: this.#stepPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: this.#held[this.#heldSlot].createView() },
					{ binding: 1, resource: this.#live[liveSlot].createView() },
					{ binding: 2, resource: this.#live[previousSlot].createView() },
					{ binding: 3, resource: { buffer: vectors[vectorSlot] } },
					{ binding: 4, resource: { buffer: vectors[lagSlot] } },
					{ binding: 5, resource: this.#held[nextHeldSlot].createView() },
					{ binding: 6, resource: { buffer: this.#uniform(stepUniforms) } }
				]
			})
		);
		step.dispatchWorkgroups(dispatchCount(this.#width, 8), dispatchCount(this.#height, 8));
		step.end();

		const weight = resolveVideoMoshHealWeight(frame, window.durationFrames, window.healFrames);
		let output = this.#held[nextHeldSlot];
		if (weight >= 1) {
			output = this.#live[liveSlot];
		} else if (weight > 0) {
			const heal = encoder.beginComputePass();
			heal.setPipeline(this.#healPipeline);
			heal.setBindGroup(
				0,
				this.#device.createBindGroup({
					layout: this.#healPipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: this.#held[nextHeldSlot].createView() },
						{ binding: 1, resource: this.#live[liveSlot].createView() },
						{ binding: 2, resource: this.#healed.createView() },
						{
							binding: 3,
							resource: { buffer: this.#uniform(new Float32Array([weight, 0, 0, 0]).buffer) }
						}
					]
				})
			);
			heal.dispatchWorkgroups(dispatchCount(this.#width, 8), dispatchCount(this.#height, 8));
			heal.end();
			output = this.#healed;
		}
		this.#device.queue.submit([encoder.finish()]);
		this.#releaseFrameUniforms();
		this.#liveSlot = liveSlot;
		this.#heldSlot = nextHeldSlot;
		this.#vectorSlot = vectorSlot;
		this.#localFrame = frame;
		return output;
	}

	/**
	 * Uniform buffers live for one submit. They are destroyed only after the
	 * queue finishes with them, so a frame's GPU work never reads a freed buffer.
	 */
	#releaseFrameUniforms(): void {
		const retired = this.#ownedBuffers.filter((buffer) => buffer.usage & BUFFER_UNIFORM);
		if (retired.length === 0) return;
		for (const buffer of retired) {
			this.#ownedBuffers.splice(this.#ownedBuffers.indexOf(buffer), 1);
		}
		void this.#device.queue.onSubmittedWorkDone().then(() => {
			for (const buffer of retired) buffer.destroy();
		});
	}
}
