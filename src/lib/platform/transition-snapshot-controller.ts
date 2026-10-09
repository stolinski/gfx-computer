import { cloneJsonValue } from '$lib/utils/json-clone';

import type {
	CompositionFrameRenderResult,
	CachedTransitionFrame
} from './composition-frame-renderer';
import {
	settleSwappedCompositionState,
	type CompositionStateSwapSettleDependencies
} from './composition-state-swap-settle';
import type { Preset } from './engine-schema';
import type { ResolvedTransition } from './engine-state.svelte';
import type { GpuHost } from './gpu-host';
import {
	compileTransitionEffect,
	type CompiledTransitionEffect
} from './pipelines/transition-pass';
import { getLoadedTransitionEffectRenderer } from './pipelines/runtime-loader';
import type { TransitionEffectRenderer } from './pipelines/types';
import {
	TransitionSnapshots,
	type TransitionSnapshotFrameTextures,
	type TransitionSnapshotsOptions
} from './pipelines/transition-snapshots';

const TRANSITION_SNAPSHOT_PROGRESS = 0.5;

/**
 * The settle steps (`CompositionStateSwapSettleDependencies`) run once per
 * swapped-in endpoint, before its frame is rendered.
 */
export interface TransitionSnapshotControllerDependencies extends CompositionStateSwapSettleDependencies {
	host: GpuHost;
	width: number;
	height: number;
	captureCompositionState(): Preset;
	applyCompositionState(preset: Preset): void;
	readCapturing(): boolean;
	writeCapturing(value: boolean): void;
	renderFrame(outputView: GPUTextureView, timestamp: number): CompositionFrameRenderResult;
	isActiveTransition(transition: ResolvedTransition): boolean;
	seekTimeline(timestamp: number): void;
}

export interface TransitionSnapshotControllerFactories {
	createSnapshots(options: TransitionSnapshotsOptions): TransitionSnapshotFrameTextures;
	getTransitionEffectRenderer(type: string): TransitionEffectRenderer<unknown> | null;
	compileEffect(
		host: GpuHost,
		renderer: TransitionEffectRenderer<unknown>
	): CompiledTransitionEffect;
}

interface TransitionSnapshotCache {
	host: GpuHost;
	width: number;
	height: number;
	snapshots: TransitionSnapshotFrameTextures;
	effectType: string | null;
	effect: CompiledTransitionEffect | null;
}

function combineTransitionFailures(primary: unknown, secondary: unknown, message: string): unknown {
	return primary ? new AggregateError([primary, secondary], message) : secondary;
}

class TransitionSnapshotPreparationCancelled extends Error {
	constructor() {
		super('Transition snapshot preparation was invalidated.');
		this.name = 'TransitionSnapshotPreparationCancelled';
	}
}

const DEFAULT_FACTORIES: TransitionSnapshotControllerFactories = {
	createSnapshots: (options) => new TransitionSnapshots(options),
	getTransitionEffectRenderer: getLoadedTransitionEffectRenderer,
	compileEffect: compileTransitionEffect
};

/**
 * Owns the cached from/to textures and the state-swap bracket used to populate
 * them. Workspace supplies every live Svelte, DOM, timeline, and GPU dependency;
 * this controller owns only transition cache lifecycle and ordering.
 */
export class TransitionSnapshotController {
	readonly #factories: TransitionSnapshotControllerFactories;
	#cache: TransitionSnapshotCache | null = null;
	#preparedFor: ResolvedTransition | null = null;
	#preparedFrom: Preset | null = null;
	#preparedTo: Preset | null = null;
	#preparingFor: ResolvedTransition | null = null;
	#preparationRevision = 0;
	#preparation: Promise<void> | null = null;
	#revision = 0;
	#isDisposed = false;

	constructor(factories: TransitionSnapshotControllerFactories = DEFAULT_FACTORIES) {
		this.#factories = factories;
	}

	cachedFrame(): CachedTransitionFrame | null {
		if (!this.#preparedFor || !this.#cache) {
			return null;
		}
		if (!this.#cache.effect) return null;
		return {
			snapshots: this.#cache.snapshots,
			effect: this.#cache.effect,
			params: this.#preparedFor.params,
			durationMs: this.#preparedFor.durationMs,
			width: this.#cache.width,
			height: this.#cache.height
		};
	}

	async update(
		active: ResolvedTransition | null,
		dependencies?: TransitionSnapshotControllerDependencies
	): Promise<void> {
		if (this.#isDisposed) {
			return;
		}
		if (!active) {
			this.invalidate();
			return;
		}
		if (!dependencies) {
			throw new TypeError(
				'Transition snapshot dependencies are required for an active transition.'
			);
		}

		if (this.#preparation) {
			if (this.#preparingFor === active && this.#preparationRevision === this.#revision) {
				return this.#preparation;
			}
			if (this.#preparationRevision === this.#revision) {
				this.invalidate();
			}
			await this.#preparation.catch(() => undefined);
			if (!dependencies.isActiveTransition(active)) {
				return;
			}
			return this.update(active, dependencies);
		}

		if (this.#isPreparedFor(active, dependencies)) {
			this.#ensureEffect(active, dependencies);
			this.#preparedFor = active;
			return;
		}

		const revision = ++this.#revision;
		this.#preparedFor = null;
		this.#preparedFrom = null;
		this.#preparedTo = null;
		this.#preparingFor = active;
		this.#preparationRevision = revision;
		const preparation = this.#prepare(active, dependencies, revision);
		this.#preparation = preparation;
		try {
			await preparation;
		} catch (error) {
			if (!(error instanceof TransitionSnapshotPreparationCancelled)) {
				throw error;
			}
		} finally {
			if (this.#preparation === preparation) {
				this.#preparation = null;
				this.#preparingFor = null;
			}
		}
	}

	invalidate(): void {
		this.#revision += 1;
		this.#preparedFor = null;
		this.#preparedFrom = null;
		this.#preparedTo = null;
		this.#disposeCache();
	}

	dispose(): void {
		if (this.#isDisposed) {
			return;
		}
		this.#isDisposed = true;
		this.invalidate();
	}

	#isPreparedFor(
		active: ResolvedTransition,
		dependencies: TransitionSnapshotControllerDependencies
	): boolean {
		return (
			this.#preparedFrom === active.from &&
			this.#preparedTo === active.to &&
			this.#cache?.host === dependencies.host &&
			this.#cache.width === dependencies.width &&
			this.#cache.height === dependencies.height
		);
	}

	#ensureCache(dependencies: TransitionSnapshotControllerDependencies): TransitionSnapshotCache {
		const cache = this.#cache;
		if (
			cache &&
			cache.host === dependencies.host &&
			cache.width === dependencies.width &&
			cache.height === dependencies.height
		) {
			return cache;
		}

		this.#disposeCache();
		const snapshots = this.#factories.createSnapshots({
			host: dependencies.host,
			width: dependencies.width,
			height: dependencies.height
		});
		try {
			const next = {
				host: dependencies.host,
				width: dependencies.width,
				height: dependencies.height,
				snapshots,
				effectType: null,
				effect: null
			};
			this.#cache = next;
			return next;
		} catch (error) {
			snapshots.dispose();
			throw error;
		}
	}

	async #prepare(
		active: ResolvedTransition,
		dependencies: TransitionSnapshotControllerDependencies,
		revision: number
	): Promise<void> {
		const cache = this.#ensureCache(dependencies);
		this.#ensureEffect(active, dependencies);
		let sourceComposition: Preset;
		let wasCapturing: boolean;
		try {
			sourceComposition = dependencies.captureCompositionState();
			wasCapturing = dependencies.readCapturing();
			dependencies.writeCapturing(true);
		} catch (error) {
			this.#disposeCache();
			throw error;
		}

		let failure: unknown;
		try {
			const targetOrientation = sourceComposition.state.transport.orientation;
			await this.#capturePreset(
				active.from,
				cache.snapshots.fromTarget(),
				targetOrientation,
				dependencies,
				revision
			);
			await this.#capturePreset(
				active.to,
				cache.snapshots.toTarget(),
				targetOrientation,
				dependencies,
				revision
			);
		} catch (error) {
			failure = error;
		}

		try {
			dependencies.applyCompositionState(sourceComposition);
			await dependencies.flushDom();
			await dependencies.waitForLayout();
		} catch (error) {
			failure = combineTransitionFailures(
				failure,
				error,
				'Transition capture and restoration both failed.'
			);
		}
		try {
			dependencies.writeCapturing(wasCapturing);
		} catch (error) {
			failure = combineTransitionFailures(
				failure,
				error,
				'Transition preparation failed while restoring its capture bracket.'
			);
		}

		if (failure) {
			this.#disposeCache();
			throw failure;
		}
		this.#assertCurrent(revision);
		if (!dependencies.isActiveTransition(active)) {
			this.#disposeCache();
			throw new TransitionSnapshotPreparationCancelled();
		}

		this.#preparedFor = active;
		this.#preparedFrom = active.from;
		this.#preparedTo = active.to;
		dependencies.seekTimeline(0);
	}

	#ensureEffect(
		active: ResolvedTransition,
		dependencies: TransitionSnapshotControllerDependencies
	): void {
		const cache = this.#ensureCache(dependencies);
		if (cache.effectType === active.effect && cache.effect) return;
		const renderer = this.#factories.getTransitionEffectRenderer(active.effect);
		if (!renderer) {
			throw new Error(`Unknown transition Effect "${active.effect}".`);
		}
		const next = this.#factories.compileEffect(dependencies.host, renderer);
		cache.effect?.dispose?.();
		cache.effect = next;
		cache.effectType = active.effect;
	}

	async #capturePreset(
		preset: Preset,
		target: GPUTextureView,
		orientation: Preset['state']['transport']['orientation'],
		dependencies: TransitionSnapshotControllerDependencies,
		revision: number
	): Promise<void> {
		this.#assertCurrent(revision);
		const capturePreset = cloneJsonValue(preset);
		capturePreset.state.transport.orientation = orientation;
		dependencies.applyCompositionState(capturePreset);
		await settleSwappedCompositionState(dependencies, TRANSITION_SNAPSHOT_PROGRESS, () =>
			this.#assertCurrent(revision)
		);
		const result = dependencies.renderFrame(
			target,
			TRANSITION_SNAPSHOT_PROGRESS * preset.state.transport.durationSeconds
		);
		if (result === 'unavailable') {
			throw new Error(`Transition snapshot render was unavailable for "${preset.name}".`);
		}
	}

	#assertCurrent(revision: number): void {
		if (this.#isDisposed || revision !== this.#revision) {
			throw new TransitionSnapshotPreparationCancelled();
		}
	}

	#disposeCache(): void {
		this.#cache?.effect?.dispose?.();
		this.#cache?.snapshots.dispose();
		this.#cache = null;
	}
}
