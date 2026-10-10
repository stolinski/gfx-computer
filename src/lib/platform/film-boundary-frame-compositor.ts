import type {
	FilmBoundaryFrameComposite,
	FilmBoundaryFrameSide,
	FilmBoundaryFrameSurface
} from './film-boundary-frame';
import type { FilmSceneWindowBoundary } from './film-schema';
import type { GpuHost } from './gpu-host';
import { filmBoundaryFadeEffectRenderer } from './pipelines/film-boundary-fade';
import {
	compileFilmMagicMoveQuadPass,
	type CompiledFilmMagicMoveQuadPass
} from './pipelines/film-magic-move-quad-pass';
import { getLoadedTransitionEffectRenderer } from './pipelines/runtime-loader';
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
	/** The loaded renderer of a registered transition effect, or `null` when it is not loaded. */
	readTransitionEffectRenderer(type: string): TransitionEffectRenderer<unknown> | null;
	/** A frame-sized texture one magic-move element is captured into, straight-alpha. */
	createMagicMoveElementTexture(target: FilmBoundaryFrameCompositorTarget): GPUTexture;
	compileMagicMoveQuadPass(host: GpuHost): CompiledFilmMagicMoveQuadPass;
}

const TEXTURE_USAGE_COPY_DST = 0x02;
const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
// What both DOM capture lanes need of their destination, as the Overlay planes
// declare it (`./pipelines/composition-planes.ts`).
const MAGIC_MOVE_ELEMENT_TEXTURE_USAGE =
	TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_RENDER_ATTACHMENT;

const DEFAULT_FACTORIES: FilmBoundaryFrameCompositorFactories = {
	createSceneTargets: (options) => new TransitionSnapshots(options),
	compileEffect: compileTransitionEffect,
	readTransitionEffectRenderer: getLoadedTransitionEffectRenderer,
	createMagicMoveElementTexture: ({ host, width, height }) =>
		host.device.createTexture({
			size: [width, height, 1],
			format: 'rgba8unorm',
			usage: MAGIC_MOVE_ELEMENT_TEXTURE_USAGE
		}),
	compileMagicMoveQuadPass: compileFilmMagicMoveQuadPass
};

type FilmWindowBoundaryKind = FilmSceneWindowBoundary['kind'];

interface FilmBoundaryFrameCompositorResources extends FilmBoundaryFrameCompositorTarget {
	sceneTargets: TransitionSnapshotFrameTextures;
	effects: Map<FilmWindowBoundaryKind, CompiledTransitionEffect>;
	/** Each magic-move pair's two element captures, by pair index. Made when first asked for. */
	magicMoveElements: Map<number, Record<FilmBoundaryFrameSide, GPUTexture>>;
	/** Compiled on the first frame that draws a quad. */
	magicMoveQuadPass: CompiledFilmMagicMoveQuadPass | null;
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
 *
 * A boundary that carries a magic move (ADR-0068 §5) also gets two capture
 * textures per pair, one for the element in each Scene, and the quad pass that
 * draws them over the composited frame. They are made when a frame first asks
 * for them and released by the first composite that draws fewer pairs, so only
 * a window that is carrying elements holds them.
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
			effects: new Map(),
			magicMoveElements: new Map(),
			magicMoveQuadPass: null
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

	readMagicMoveElementTexture(pairIndex: number, side: FilmBoundaryFrameSide): GPUTexture {
		const resources = this.#prepared();
		let textures = resources.magicMoveElements.get(pairIndex);
		if (!textures) {
			textures = {
				outgoing: this.#factories.createMagicMoveElementTexture(resources),
				incoming: this.#factories.createMagicMoveElementTexture(resources)
			};
			resources.magicMoveElements.set(pairIndex, textures);
		}
		return textures[side];
	}

	/**
	 * Composite the two Scene targets, as last rendered, into `outputView`, then
	 * draw each magic-move quad over it, in the order given, from that pair's two
	 * element captures as last captured.
	 *
	 * Every effect is a function of the two views, the window's progress, and the
	 * boundary's own `params`. None keeps anything from one frame to the next,
	 * so a frame is the same whichever frame was composited before it.
	 *
	 * Throws an `Error` when the boundary names a transition effect whose
	 * renderer is not loaded; `ensureFilmRenderersLoaded` loads every one a
	 * Film's boundaries name before the Film opens. Throws an `Error` for a quad
	 * whose pair was never captured.
	 */
	composite({ boundary, progress, magicMoveQuads, outputView }: FilmBoundaryFrameComposite): void {
		const resources = this.#prepared();
		let effect = resources.effects.get(boundary.kind);
		if (!effect) {
			effect = this.#factories.compileEffect(resources.host, this.#effectRenderer(boundary.kind));
			resources.effects.set(boundary.kind, effect);
		}
		effect.apply({
			fromView: resources.sceneTargets.fromTexture().createView(),
			toView: resources.sceneTargets.toTexture().createView(),
			outputView,
			// A fade has nothing to set; an effect's params are the boundary's own.
			params: boundary.kind === 'fade' ? {} : boundary.params,
			context: {
				progress,
				// A boundary's effect is a function of its window progress alone.
				timestamp: 0,
				canvasWidth: resources.width,
				canvasHeight: resources.height
			}
		});

		for (const [pairIndex, quad] of magicMoveQuads.entries()) {
			const textures = resources.magicMoveElements.get(pairIndex);
			if (!textures) {
				throw new Error(
					`Magic-move pair ${pairIndex} has no captures: both Scenes are captured before the composite.`
				);
			}
			resources.magicMoveQuadPass ??= this.#factories.compileMagicMoveQuadPass(resources.host);
			resources.magicMoveQuadPass.draw({
				pairIndex,
				fromTexture: textures.outgoing,
				toTexture: textures.incoming,
				quad,
				outputView,
				canvasWidth: resources.width,
				canvasHeight: resources.height
			});
		}
		// A frame that carries fewer elements than the last lets the rest go.
		for (const [pairIndex, textures] of resources.magicMoveElements) {
			if (pairIndex < magicMoveQuads.length) continue;
			textures.outgoing.destroy();
			textures.incoming.destroy();
			resources.magicMoveElements.delete(pairIndex);
		}
	}

	dispose(): void {
		this.#isDisposed = true;
		this.#release();
	}

	/**
	 * The effect a boundary kind composites its two Scenes with. Every one is
	 * written to the transition pass's contract (a from-view, a to-view, a
	 * `progress` uniform): the fade, and each registered transition effect.
	 */
	#effectRenderer(kind: FilmWindowBoundaryKind): TransitionEffectRenderer<unknown> {
		if (kind === 'fade') {
			return filmBoundaryFadeEffectRenderer as TransitionEffectRenderer<unknown>;
		}
		const renderer = this.#factories.readTransitionEffectRenderer(kind);
		if (!renderer) {
			throw new Error(`The transition effect "${kind}" of a Scene boundary is not loaded.`);
		}
		return renderer;
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
		for (const textures of resources.magicMoveElements.values()) {
			textures.outgoing.destroy();
			textures.incoming.destroy();
		}
		resources.sceneTargets.dispose();
	}
}
