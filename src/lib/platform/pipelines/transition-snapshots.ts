import type { GpuHost } from '$lib/platform/gpu-host';

/**
 * Owns the two colour textures a Scene boundary's effect composites
 * (ADR-0068 §4): `from` holds the finished frame of the outgoing Scene and
 * `to` the finished frame of the incoming one. The Scene frame stepper renders
 * each Scene into its target on every window frame, with the present pass
 * pointed at the target's view instead of the canvas, and the boundary's effect
 * then samples both (`../film-boundary-frame-compositor.ts`). The names are
 * the transition pass's: a from-view and a to-view.
 *
 * Textures are the host's canvas format (the present pass's output format) with
 * RENDER_ATTACHMENT (capture target) + TEXTURE_BINDING (sampled by the wipe).
 * Sized to the canvas at construction, like EffectChain / ShaderPassDispatcher;
 * disposed alongside the host.
 */

const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const SNAPSHOT_TEXTURE_USAGE = TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT;

export interface TransitionSnapshotsOptions {
	host: GpuHost;
	width: number;
	height: number;
}

export interface TransitionSnapshotFrameTextures {
	fromTarget(): GPUTextureView;
	toTarget(): GPUTextureView;
	fromTexture(): GPUTexture;
	toTexture(): GPUTexture;
	dispose(): void;
}

export class TransitionSnapshots implements TransitionSnapshotFrameTextures {
	#fromTexture: GPUTexture;
	#toTexture: GPUTexture;

	constructor({ host, width, height }: TransitionSnapshotsOptions) {
		const descriptor: GPUTextureDescriptor = {
			size: [width, height, 1],
			format: host.format,
			usage: SNAPSHOT_TEXTURE_USAGE
		};
		this.#fromTexture = host.device.createTexture(descriptor);
		this.#toTexture = host.device.createTexture(descriptor);
	}

	/** Render-attachment view the outgoing Scene's finished frame is rendered into. */
	fromTarget(): GPUTextureView {
		return this.#fromTexture.createView();
	}

	/** Render-attachment view the incoming Scene's finished frame is rendered into. */
	toTarget(): GPUTextureView {
		return this.#toTexture.createView();
	}

	/** The outgoing Scene's frame as last rendered, sampled by the boundary's effect. */
	fromTexture(): GPUTexture {
		return this.#fromTexture;
	}

	/** The incoming Scene's frame as last rendered, sampled by the boundary's effect. */
	toTexture(): GPUTexture {
		return this.#toTexture;
	}

	dispose(): void {
		this.#fromTexture.destroy();
		this.#toTexture.destroy();
	}
}
