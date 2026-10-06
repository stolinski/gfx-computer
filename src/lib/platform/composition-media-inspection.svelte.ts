import type { UserVideoAssetDescriptor, UserVideoAssetMetadata } from './user-video-asset';
import { inspectUserVideoAssetUrl } from './user-video-upload-transport';

export type CompositionMediaInspectionState =
	| { status: 'idle' }
	| { status: 'probing' }
	| { status: 'ready'; metadata: UserVideoAssetMetadata }
	| { status: 'error'; message: string };

export type UserVideoAssetInspectionService = (
	assetUrl: string
) => Promise<UserVideoAssetMetadata>;

const IDLE_INSPECTION_STATE: CompositionMediaInspectionState = { status: 'idle' };

function descriptorMetadata(descriptor: UserVideoAssetDescriptor): UserVideoAssetMetadata {
	return {
		durationSeconds: descriptor.durationSeconds,
		displayWidth: descriptor.displayWidth,
		displayHeight: descriptor.displayHeight,
		rotation: descriptor.rotation,
		averageFrameRate: descriptor.averageFrameRate,
		videoCodec: descriptor.videoCodec,
		hasAudio: descriptor.hasAudio,
		audioCodec: descriptor.audioCodec,
		audioChannels: descriptor.audioChannels,
		audioSampleRate: descriptor.audioSampleRate
	};
}

export class CompositionMediaInspection {
	#states = $state.raw<Record<string, CompositionMediaInspectionState>>({});
	#generations: Record<string, number> = {};
	#inflight: Record<string, Promise<void> | undefined> = {};
	readonly #inspectAsset: UserVideoAssetInspectionService;

	constructor(inspectAsset: UserVideoAssetInspectionService) {
		this.#inspectAsset = inspectAsset;
	}

	read(assetUrl: string): CompositionMediaInspectionState {
		return this.#states[assetUrl] ?? IDLE_INSPECTION_STATE;
	}

	seed(descriptor: UserVideoAssetDescriptor): void {
		this.#advanceGeneration(descriptor.url);
		delete this.#inflight[descriptor.url];
		this.#setState(descriptor.url, {
			status: 'ready',
			metadata: descriptorMetadata(descriptor)
		});
	}

	ensure(assetUrl: string): Promise<void> {
		const current = this.read(assetUrl);
		if (current.status === 'ready') return Promise.resolve();
		if (current.status === 'probing') {
			const inflight = this.#inflight[assetUrl];
			if (inflight) return inflight;
		}

		const generation = this.#advanceGeneration(assetUrl);
		this.#setState(assetUrl, { status: 'probing' });
		const probe = this.#inspectAsset(assetUrl)
			.then((metadata) => {
				if (this.#generations[assetUrl] !== generation) return;
				this.#setState(assetUrl, { status: 'ready', metadata });
			})
			.catch((error: unknown) => {
				if (this.#generations[assetUrl] !== generation) return;
				this.#setState(assetUrl, {
					status: 'error',
					message: error instanceof Error ? error.message : 'Video inspection failed.'
				});
			})
			.finally(() => {
				if (this.#inflight[assetUrl] === probe) delete this.#inflight[assetUrl];
			});
		this.#inflight[assetUrl] = probe;
		return probe;
	}

	forget(assetUrl: string): void {
		this.#advanceGeneration(assetUrl);
		delete this.#inflight[assetUrl];
		if (!(assetUrl in this.#states)) return;
		const remainingStates = { ...this.#states };
		delete remainingStates[assetUrl];
		this.#states = remainingStates;
	}

	#setState(assetUrl: string, state: CompositionMediaInspectionState): void {
		this.#states = { ...this.#states, [assetUrl]: state };
	}

	#advanceGeneration(assetUrl: string): number {
		const generation = (this.#generations[assetUrl] ?? 0) + 1;
		this.#generations[assetUrl] = generation;
		return generation;
	}
}

export function createCompositionMediaInspection(
	inspectAsset: UserVideoAssetInspectionService = inspectUserVideoAssetUrl
): CompositionMediaInspection {
	return new CompositionMediaInspection(inspectAsset);
}

export const compositionMediaInspection = createCompositionMediaInspection();
