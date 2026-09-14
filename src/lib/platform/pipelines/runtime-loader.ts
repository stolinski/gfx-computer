import { PIPELINE_DEFINITION_REGISTRY } from './definition-registry';

import type {
	AnnotationRenderer,
	BlockRenderer,
	EffectRenderer,
	OverlayRenderer,
	SurfaceRenderer,
	TransitionEffectRenderer
} from './types';

export type RuntimeRenderer =
	| SurfaceRenderer
	| BlockRenderer
	| AnnotationRenderer
	| OverlayRenderer
	| EffectRenderer
	| TransitionEffectRenderer<unknown>;

export type RuntimeRendererLoader<T extends RuntimeRenderer> = () => Promise<T>;

const surfaceRendererLoaders: Record<string, RuntimeRendererLoader<SurfaceRenderer>> = {
	[PIPELINE_DEFINITION_REGISTRY.surfaces.paper.type]: () =>
		import('$lib/pipelines/surfaces/paper').then(
			(module) => module.paperSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.plain.type]: () =>
		import('$lib/pipelines/surfaces/plain').then(
			(module) => module.plainSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.newspaper.type]: () =>
		import('$lib/pipelines/surfaces/newspaper').then(
			(module) => module.newspaperSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.pullquoteOnPhoto.type]: () =>
		import('$lib/pipelines/surfaces/pullquote-on-photo').then(
			(module) => module.pullquoteOnPhotoSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.chapterCard.type]: () =>
		import('$lib/pipelines/surfaces/chapter-card').then(
			(module) => module.chapterCardSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.brandMark.type]: () =>
		import('$lib/pipelines/surfaces/brand-mark').then(
			(module) => module.brandMarkSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.titleSequence.type]: () =>
		import('$lib/pipelines/surfaces/title-sequence').then(
			(module) => module.titleSequenceSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.typeHero.type]: () =>
		import('$lib/pipelines/surfaces/type-hero').then(
			(module) => module.typeHeroSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.webDocument.type]: () =>
		import('$lib/pipelines/surfaces/web-document').then(
			(module) => module.webDocumentSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.websiteScreenshot.type]: () =>
		import('$lib/pipelines/surfaces/website-screenshot').then(
			(module) => module.websiteScreenshotSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.imessage.type]: () =>
		import('$lib/pipelines/surfaces/imessage').then(
			(module) => module.imessageSurfaceRenderer as unknown as SurfaceRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.surfaces.checklist.type]: () =>
		import('$lib/pipelines/surfaces/checklist').then(
			(module) => module.checklistSurfaceRenderer as unknown as SurfaceRenderer
		)
};

const blockRendererLoaders: Record<string, RuntimeRendererLoader<BlockRenderer>> = {
	[PIPELINE_DEFINITION_REGISTRY.blocks.paragraph.type]: () =>
		import('$lib/pipelines/blocks/paragraph').then(
			(module) => module.paragraphBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.node.type]: () =>
		import('$lib/pipelines/blocks/node').then(
			(module) => module.nodeBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.edgeArrow.type]: () =>
		import('$lib/pipelines/blocks/edge-arrow').then(
			(module) => module.edgeArrowBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.label.type]: () =>
		import('$lib/pipelines/blocks/label').then(
			(module) => module.labelBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.statCallout.type]: () =>
		import('$lib/pipelines/blocks/stat-callout').then(
			(module) => module.statCalloutBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.timelineSegment.type]: () =>
		import('$lib/pipelines/blocks/timeline-segment').then(
			(module) => module.timelineSegmentBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.barChart.type]: () =>
		import('$lib/pipelines/blocks/bar-chart').then(
			(module) => module.barChartBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.columnChart.type]: () =>
		import('$lib/pipelines/blocks/column-chart').then(
			(module) => module.columnChartBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.lineChart.type]: () =>
		import('$lib/pipelines/blocks/line-chart').then(
			(module) => module.lineChartBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.unitGridChart.type]: () =>
		import('$lib/pipelines/blocks/unit-grid-chart').then(
			(module) => module.unitGridChartBlockRenderer as unknown as BlockRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.blocks.dotFieldChart.type]: () =>
		import('$lib/pipelines/blocks/dot-field-chart').then(
			(module) => module.dotFieldChartBlockRenderer as unknown as BlockRenderer
		)
};

const annotationRendererLoaders: Record<string, RuntimeRendererLoader<AnnotationRenderer>> = {
	[PIPELINE_DEFINITION_REGISTRY.annotations.highlight.style]: () =>
		import('$lib/pipelines/annotations/highlight').then(
			(module) => module.highlightAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.underline.style]: () =>
		import('$lib/pipelines/annotations/underline').then(
			(module) => module.underlineAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.strike.style]: () =>
		import('$lib/pipelines/annotations/strike').then(
			(module) => module.strikeAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.circle.style]: () =>
		import('$lib/pipelines/annotations/circle').then(
			(module) => module.circleAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.box.style]: () =>
		import('$lib/pipelines/annotations/box').then(
			(module) => module.boxAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.sideNote.style]: () =>
		import('$lib/pipelines/annotations/side-note').then(
			(module) => module.sideNoteAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.magnify.style]: () =>
		import('$lib/pipelines/annotations/magnify').then(
			(module) => module.magnifyAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.liftOut.style]: () =>
		import('$lib/pipelines/annotations/lift-out').then(
			(module) => module.liftOutAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.tearOut.style]: () =>
		import('$lib/pipelines/annotations/tear-out').then(
			(module) => module.tearOutAnnotationRenderer as unknown as AnnotationRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.annotations.isolate.style]: () =>
		import('$lib/pipelines/annotations/isolate').then(
			(module) => module.isolateAnnotationRenderer as unknown as AnnotationRenderer
		)
};

const overlayRendererLoaders: Record<string, RuntimeRendererLoader<OverlayRenderer>> = {
	[PIPELINE_DEFINITION_REGISTRY.overlays.lowerThird.type]: () =>
		import('$lib/pipelines/overlays/lower-third').then(
			(module) => module.lowerThirdOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.washiTape.type]: () =>
		import('$lib/pipelines/overlays/washi-tape').then(
			(module) => module.washiTapeOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.watermark.type]: () =>
		import('$lib/pipelines/overlays/watermark').then(
			(module) => module.watermarkOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.shaderFill.type]: () =>
		import('$lib/pipelines/overlays/shader-fill').then(
			(module) => module.shaderFillOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.cursorTrail.type]: () =>
		import('$lib/pipelines/overlays/cursor-trail').then(
			(module) => module.cursorTrailOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.dimensionalType.type]: () =>
		import('$lib/pipelines/overlays/dimensional-type').then(
			(module) => module.dimensionalTypeOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.counter.type]: () =>
		import('$lib/pipelines/overlays/counter').then(
			(module) => module.counterOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.instanceStack.type]: () =>
		import('$lib/pipelines/overlays/instance-stack').then(
			(module) => module.instanceStackOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.text3d.type]: () =>
		import('$lib/pipelines/overlays/text-3d').then(
			(module) => module.text3dOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.tweetStack.type]: () =>
		import('$lib/pipelines/overlays/tweet-stack').then(
			(module) => module.tweetStackOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.youtubeSubscribe.type]: () =>
		import('$lib/pipelines/overlays/youtube-subscribe').then(
			(module) => module.youtubeSubscribeOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.instagramFollow.type]: () =>
		import('$lib/pipelines/overlays/instagram-follow').then(
			(module) => module.instagramFollowOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.achievement.type]: () =>
		import('$lib/pipelines/overlays/achievement').then(
			(module) => module.achievementOverlayRenderer as unknown as OverlayRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.overlays.sourceUrl.type]: () =>
		import('$lib/pipelines/overlays/source-url').then(
			(module) => module.sourceUrlOverlayRenderer as unknown as OverlayRenderer
		)
};

const effectRendererLoaders: Record<string, RuntimeRendererLoader<EffectRenderer>> = {
	[PIPELINE_DEFINITION_REGISTRY.effects.paperGrain.type]: () =>
		import('$lib/pipelines/effects/paper-grain').then(
			(module) => module.paperGrainEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.chromaticAberration.type]: () =>
		import('$lib/pipelines/effects/chromatic-aberration').then(
			(module) => module.chromaticAberrationEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.crtScreen.type]: () =>
		import('$lib/pipelines/effects/crt-screen').then(
			(module) => module.crtScreenEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.crtTube.type]: () =>
		import('$lib/pipelines/effects/crt-tube').then(
			(module) => module.crtTubeEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.ntscSignal.type]: () =>
		import('$lib/pipelines/effects/ntsc-signal').then(
			(module) => module.ntscSignalEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.dithering.type]: () =>
		import('$lib/pipelines/effects/dithering').then(
			(module) => module.ditheringEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.pixelation.type]: () =>
		import('$lib/pipelines/effects/pixelation').then(
			(module) => module.pixelationEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.halftoneDots.type]: () =>
		import('$lib/pipelines/effects/halftone-dots').then(
			(module) => module.halftoneDotsEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.halftoneCmyk.type]: () =>
		import('$lib/pipelines/effects/halftone-cmyk').then(
			(module) => module.halftoneCmykEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.water.type]: () =>
		import('$lib/pipelines/effects/water').then(
			(module) => module.waterEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.flutedGlass.type]: () =>
		import('$lib/pipelines/effects/fluted-glass').then(
			(module) => module.flutedGlassEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.refractiveLens.type]: () =>
		import('$lib/pipelines/effects/refractive-lens').then(
			(module) => module.refractiveLensEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.frostedGlass.type]: () =>
		import('$lib/pipelines/effects/frosted-glass').then(
			(module) => module.frostedGlassEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.fluidRipple.type]: () =>
		import('$lib/pipelines/effects/fluid-ripple').then(
			(module) => module.fluidRippleEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.clothBend.type]: () =>
		import('$lib/pipelines/effects/cloth-bend').then(
			(module) => module.clothBendEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.tiledDeformation.type]: () =>
		import('$lib/pipelines/effects/tiled-deformation').then(
			(module) => module.tiledDeformationEffectRenderer as unknown as EffectRenderer
		),
	[PIPELINE_DEFINITION_REGISTRY.effects.heatmap.type]: () =>
		import('$lib/pipelines/effects/heatmap').then(
			(module) => module.heatmapEffectRenderer as unknown as EffectRenderer
		)
};
const transitionRendererLoaders: Record<
	string,
	RuntimeRendererLoader<TransitionEffectRenderer<unknown>>
> = {
	'mask-wipe': () =>
		import('$lib/pipelines/effects/mask-wipe').then(
			(module) => module.maskWipeTransitionEffectRenderer as TransitionEffectRenderer<unknown>
		),
	'particle-dissolve': () =>
		import('$lib/pipelines/effects/particle-dissolve').then(
			(module) =>
				module.particleDissolveTransitionEffectRenderer as TransitionEffectRenderer<unknown>
		),
	'seeded-shatter': () =>
		import('$lib/pipelines/effects/seeded-shatter').then(
			(module) => module.seededShatterTransitionEffectRenderer as TransitionEffectRenderer<unknown>
		),
	'sheet-peel': () =>
		import('$lib/pipelines/effects/sheet-peel').then(
			(module) => module.sheetPeelTransitionEffectRenderer as TransitionEffectRenderer<unknown>
		)
};

export interface PipelineRuntimeLoaderRegistry {
	surfaces: Record<string, RuntimeRendererLoader<SurfaceRenderer>>;
	blocks: Record<string, RuntimeRendererLoader<BlockRenderer>>;
	annotations: Record<string, RuntimeRendererLoader<AnnotationRenderer>>;
	overlays: Record<string, RuntimeRendererLoader<OverlayRenderer>>;
	effects: Record<string, RuntimeRendererLoader<EffectRenderer>>;
	transitions: Record<string, RuntimeRendererLoader<TransitionEffectRenderer<unknown>>>;
}

export const PIPELINE_RUNTIME_LOADERS: PipelineRuntimeLoaderRegistry = {
	surfaces: surfaceRendererLoaders,
	blocks: blockRendererLoaders,
	annotations: annotationRendererLoaders,
	overlays: overlayRendererLoaders,
	effects: effectRendererLoaders,
	transitions: transitionRendererLoaders
};

export interface PipelineRendererRequirements {
	surfaces: ReadonlySet<string>;
	blocks: ReadonlySet<string>;
	annotations: ReadonlySet<string>;
	overlays: ReadonlySet<string>;
	effects: ReadonlySet<string>;
	transitions: ReadonlySet<string>;
}

export interface ResolvedPipelineRendererBundle {
	surfaces: ReadonlyMap<string, SurfaceRenderer>;
	blocks: ReadonlyMap<string, BlockRenderer>;
	annotations: ReadonlyMap<string, AnnotationRenderer>;
	overlays: ReadonlyMap<string, OverlayRenderer>;
	effects: ReadonlyMap<string, EffectRenderer>;
	transitions: ReadonlyMap<string, TransitionEffectRenderer<unknown>>;
}

function emptyBundle(): ResolvedPipelineRendererBundle {
	return {
		surfaces: new Map(),
		blocks: new Map(),
		annotations: new Map(),
		overlays: new Map(),
		effects: new Map(),
		transitions: new Map()
	};
}

function rendererIdentity(renderer: RuntimeRenderer): string {
	return 'style' in renderer ? renderer.style : renderer.type;
}

export class PipelineRendererController {
	#activeBundle: ResolvedPipelineRendererBundle = emptyBundle();
	readonly #pending = new Map<string, Promise<RuntimeRenderer>>();
	readonly #activationListeners = new Set<() => void>();
	readonly #loaders: PipelineRuntimeLoaderRegistry;

	constructor(loaders: PipelineRuntimeLoaderRegistry = PIPELINE_RUNTIME_LOADERS) {
		this.#loaders = loaders;
	}

	current(): ResolvedPipelineRendererBundle {
		return this.#activeBundle;
	}

	activate(bundle: ResolvedPipelineRendererBundle): void {
		const current = this.#activeBundle;
		this.#activeBundle = {
			surfaces: new Map([...current.surfaces, ...bundle.surfaces]),
			blocks: new Map([...current.blocks, ...bundle.blocks]),
			annotations: new Map([...current.annotations, ...bundle.annotations]),
			overlays: new Map([...current.overlays, ...bundle.overlays]),
			effects: new Map([...current.effects, ...bundle.effects]),
			transitions: new Map([...current.transitions, ...bundle.transitions])
		};
		for (const listener of this.#activationListeners) listener();
	}

	subscribeToActivation(listener: () => void): () => void {
		this.#activationListeners.add(listener);
		return () => this.#activationListeners.delete(listener);
	}

	async resolve(
		requirements: PipelineRendererRequirements
	): Promise<ResolvedPipelineRendererBundle> {
		const current = this.#activeBundle;
		const surfaces = new Map(current.surfaces);
		const blocks = new Map(current.blocks);
		const annotations = new Map(current.annotations);
		const overlays = new Map(current.overlays);
		const effects = new Map(current.effects);
		const transitions = new Map(current.transitions);

		await Promise.all([
			this.#loadRequired('surface', requirements.surfaces, this.#loaders.surfaces, surfaces),
			this.#loadRequired('block', requirements.blocks, this.#loaders.blocks, blocks),
			this.#loadRequired(
				'annotation',
				requirements.annotations,
				this.#loaders.annotations,
				annotations
			),
			this.#loadRequired('overlay', requirements.overlays, this.#loaders.overlays, overlays),
			this.#loadRequired('effect', requirements.effects, this.#loaders.effects, effects),
			this.#loadRequired(
				'transition',
				requirements.transitions,
				this.#loaders.transitions,
				transitions
			)
		]);

		return { surfaces, blocks, annotations, overlays, effects, transitions };
	}

	async ensureSurface(type: string): Promise<void> {
		const bundle = await this.resolve({
			surfaces: new Set([type]),
			blocks: new Set(),
			annotations: new Set(),
			overlays: new Set(),
			effects: new Set(),
			transitions: new Set()
		});
		this.activate(bundle);
	}

	async ensureAnnotation(type: string): Promise<void> {
		const bundle = await this.resolve({
			surfaces: new Set(),
			blocks: new Set(),
			annotations: new Set([type]),
			overlays: new Set(),
			effects: new Set(),
			transitions: new Set()
		});
		this.activate(bundle);
	}

	async ensureOverlay(type: string): Promise<void> {
		const bundle = await this.resolve({
			surfaces: new Set(),
			blocks: new Set(),
			annotations: new Set(),
			overlays: new Set([type]),
			effects: new Set(),
			transitions: new Set()
		});
		this.activate(bundle);
	}

	async ensureEffect(type: string): Promise<void> {
		const bundle = await this.resolve({
			surfaces: new Set(),
			blocks: new Set(),
			annotations: new Set(),
			overlays: new Set(),
			effects: new Set([type]),
			transitions: new Set()
		});
		this.activate(bundle);
	}

	async ensureTransition(type: string): Promise<void> {
		const bundle = await this.resolve({
			surfaces: new Set(),
			blocks: new Set(),
			annotations: new Set(),
			overlays: new Set(),
			effects: new Set(),
			transitions: new Set([type])
		});
		this.activate(bundle);
	}

	async #loadRequired<T extends RuntimeRenderer>(
		layer: string,
		types: ReadonlySet<string>,
		loaders: Record<string, RuntimeRendererLoader<T>>,
		target: Map<string, T>
	): Promise<void> {
		await Promise.all(
			[...types].map(async (type) => {
				if (target.has(type)) return;
				const loader = loaders[type];
				if (!loader) throw new Error(`No ${layer} renderer loader registered for "${type}".`);
				const cacheKey = `${layer}:${type}`;
				let pending = this.#pending.get(cacheKey) as Promise<T> | undefined;
				if (!pending) {
					pending = loader()
						.then((renderer) => {
							if (rendererIdentity(renderer) !== type) {
								throw new Error(
									`Loaded ${layer} renderer "${rendererIdentity(renderer)}" for definition "${type}".`
								);
							}
							return renderer;
						})
						.catch((cause: unknown) => {
							this.#pending.delete(cacheKey);
							throw cause;
						});
					this.#pending.set(cacheKey, pending);
				}
				target.set(type, await pending);
			})
		);
	}
}

export const pipelineRendererController = new PipelineRendererController();

export function getLoadedSurfaceRenderer(type: string): SurfaceRenderer | null {
	return pipelineRendererController.current().surfaces.get(type) ?? null;
}

export function getLoadedBlockRenderer(type: string): BlockRenderer | null {
	return pipelineRendererController.current().blocks.get(type) ?? null;
}

export function getLoadedAnnotationRenderer(type: string): AnnotationRenderer | null {
	return pipelineRendererController.current().annotations.get(type) ?? null;
}

export function getLoadedOverlayRenderer(type: string): OverlayRenderer | null {
	return pipelineRendererController.current().overlays.get(type) ?? null;
}

export function getLoadedEffectRenderer(type: string): EffectRenderer | null {
	return pipelineRendererController.current().effects.get(type) ?? null;
}

export function getLoadedTransitionEffectRenderer(
	type: string
): TransitionEffectRenderer<unknown> | null {
	return pipelineRendererController.current().transitions.get(type) ?? null;
}

export function requireLoadedSurfaceRenderer(type: string): SurfaceRenderer {
	const renderer = getLoadedSurfaceRenderer(type);
	if (!renderer) throw new Error(`Required Surface renderer "${type}" is not loaded.`);
	return renderer;
}

export function requireLoadedBlockRenderer(type: string): BlockRenderer {
	const renderer = getLoadedBlockRenderer(type);
	if (!renderer) throw new Error(`Required Block renderer "${type}" is not loaded.`);
	return renderer;
}

export function requireLoadedAnnotationRenderer(type: string): AnnotationRenderer {
	const renderer = getLoadedAnnotationRenderer(type);
	if (!renderer) throw new Error(`Required Annotation renderer "${type}" is not loaded.`);
	return renderer;
}

export function requireLoadedOverlayRenderer(type: string): OverlayRenderer {
	const renderer = getLoadedOverlayRenderer(type);
	if (!renderer) throw new Error(`Required Overlay renderer "${type}" is not loaded.`);
	return renderer;
}

export function requireLoadedEffectRenderer(type: string): EffectRenderer {
	const renderer = getLoadedEffectRenderer(type);
	if (!renderer) throw new Error(`Required Effect renderer "${type}" is not loaded.`);
	return renderer;
}
