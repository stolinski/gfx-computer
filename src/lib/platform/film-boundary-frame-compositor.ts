import type {
	FilmBoundaryEffectKind,
	FilmBoundaryFrameComposite,
	FilmBoundaryFrameSurface
} from './film-boundary-frame';
import type { GpuHost } from './gpu-host';
import { filmBoundaryFadeEffectRenderer } from './pipelines/film-boundary-fade';
import {
	compileTransitionEffect,
	type CompiledTransitionEffect
} from './pipelines/transition-pass';
import {
	TransitionSnapshots,
	type TransitionSnapshotFrameTextures,
	type TransitionSnapshotsOptions
} from './pipelines/transition-snapshots';
import type { TransitionEffectRenderer } from './pipelines/types';

/** The GPU host and native frame size the two Scene targets are made for. */
export interface FilmBoundaryFrameCompositorTarget {
	host: GpuHost;
	width: number;
	height: number;
}

export interface FilmBoundaryFrameCompositorFactories {
	createSceneTargets(options: TransitionSnapshotsOptions): TransitionSnapshotFrameTextures;
	compileEffect(
		host: GpuHost,
		renderer: TransitionEffectRenderer<unknown>
	): CompiledTransitionEffect;
}

const DEFAULT_FACTORIES: FilmBoundaryFrameCompositorFactories = {
	createSceneTargets: (options) => new TransitionSnapshots(options),
	compileEffect: compileTransitionEffect
};

/**
 * The effect each boundary kind composites its two Scenes with. Every one is
 * written to the transition pass's contract (a from-view, a to-view, a
 * `progress` uniform), so a registered transition Effect joins by one case.
 */
function filmBoundaryEffectRenderer(
	kind: FilmBoundaryEffectKind
): TransitionEffectRenderer<unknown> {
	switch (kind) {
		case 'fade':
			return filmBoundaryFadeEffectRenderer as TransitionEffectRenderer<unknown>;
	}
}

interface FilmBoundaryFrameCompositorResources extends FilmBoundaryFrameCompositorTarget {
	sceneTargets: TransitionSnapshotFrameTextures;
	effects: Map<FilmBoundaryEffectKind, CompiledTransitionEffect>;
}

/**
 * Owns the two GPU targets a Scene boundary's window frame is rendered into
 * (the outgoing Scene and the incoming Scene, each the finished frame of its
 * Scene in the canvas format) and the compiled effect that composites them
 * ([ADR-0068](../../../docs/adr/0068-films-scenes-and-live-scene-boundaries.md) §4).
 *
 * The targets are the transition lane's snapshot textures
 * (`./pipelines/transition-snapshots.ts`), allocated on first use and kept: one
 * boundary frame overwrites the last, and nothing is cached per frame. The
 * Workspace supplies the host and size; a new host or size replaces them.
 */
export class FilmBoundaryFrameCompositor implements FilmBoundaryFrameSurface {
	readonly #factories: FilmBoundaryFrameCompositorFactories;
	#resources: FilmBoundaryFrameCompositorResources | null = null;
	#isDisposed = false;

	constructor(factories: FilmBoundaryFrameCompositorFactories = DEFAULT_FACTORIES) {
		this.#factories = factories;
	}

	/**
	 * Make the two Scene targets ready for `target`. Targets already made for
	 * the same host and size are kept, with whatever was last rendered into them.
	 *
	 * Throws an `Error` once the compositor is disposed.
	 */
	prepare(target: FilmBoundaryFrameCompositorTarget): void {
		if (this.#isDisposed) {
			throw new Error('The Film boundary frame compositor is disposed.');
		}
		const resources = this.#resources;
		if (
			resources &&
			resources.host === target.host &&
			resources.width === target.width &&
			resources.height === target.height
		) {
			return;
		}
		this.#release();
		this.#resources = {
			...target,
			sceneTargets: this.#factories.createSceneTargets(target),
			effects: new Map()
		};
	}

	/** True while the targets made for `target` are still the ones held. */
	isPreparedFor(target: FilmBoundaryFrameCompositorTarget): boolean {
		const resources = this.#resources;
		return (
			resources !== null &&
			resources.host === target.host &&
			resources.width === target.width &&
			resources.height === target.height
		);
	}

	readOutgoingTarget(): GPUTextureView {
		return this.#prepared().sceneTargets.fromTarget();
	}

	readIncomingTarget(): GPUTextureView {
		return this.#prepared().sceneTargets.toTarget();
	}

	/** Composite the two Scene targets, as last rendered, into `outputView`. */
	composite({ kind, progress, outputView }: FilmBoundaryFrameComposite): void {
		const resources = this.#prepared();
		let effect = resources.effects.get(kind);
		if (!effect) {
			effect = this.#factories.compileEffect(resources.host, filmBoundaryEffectRenderer(kind));
			resources.effects.set(kind, effect);
		}
		effect.apply({
			fromView: resources.sceneTargets.fromTexture().createView(),
			toView: resources.sceneTargets.toTexture().createView(),
			outputView,
			params: {},
			context: {
				progress,
				// A boundary's effect is a function of its window progress alone.
				timestamp: 0,
				canvasWidth: resources.width,
				canvasHeight: resources.height
			}
		});
	}

	dispose(): void {
		this.#isDisposed = true;
		this.#release();
	}

	#prepared(): FilmBoundaryFrameCompositorResources {
		if (!this.#resources) {
			throw new Error('The Film boundary frame compositor has no targets: call prepare first.');
		}
		return this.#resources;
	}

	#release(): void {
		const resources = this.#resources;
		this.#resources = null;
		if (!resources) return;
		for (const effect of resources.effects.values()) effect.dispose?.();
		resources.sceneTargets.dispose();
	}
}
