import { barChartBlockDefinition } from '$lib/pipelines/blocks/bar-chart/definition';
import { columnChartBlockDefinition } from '$lib/pipelines/blocks/column-chart/definition';
import { dotFieldChartBlockDefinition } from '$lib/pipelines/blocks/dot-field-chart/definition';
import { edgeArrowBlockDefinition } from '$lib/pipelines/blocks/edge-arrow/definition';
import { lineChartBlockDefinition } from '$lib/pipelines/blocks/line-chart/definition';
import { labelBlockDefinition } from '$lib/pipelines/blocks/label/definition';
import { nodeBlockDefinition } from '$lib/pipelines/blocks/node/definition';
import { paragraphBlockDefinition } from '$lib/pipelines/blocks/paragraph/definition';
import { statCalloutBlockDefinition } from '$lib/pipelines/blocks/stat-callout/definition';
import { timelineSegmentBlockDefinition } from '$lib/pipelines/blocks/timeline-segment/definition';
import { unitGridChartBlockDefinition } from '$lib/pipelines/blocks/unit-grid-chart/definition';
import { chromaticAberrationEffectDefinition } from '$lib/pipelines/effects/chromatic-aberration/definition';
import { clothBendEffectDefinition } from '$lib/pipelines/effects/cloth-bend/definition';
import { crtScreenEffectDefinition } from '$lib/pipelines/effects/crt-screen/definition';
import { crtTubeEffectDefinition } from '$lib/pipelines/effects/crt-tube/definition';
import { ditheringEffectDefinition } from '$lib/pipelines/effects/dithering/definition';
import { flutedGlassEffectDefinition } from '$lib/pipelines/effects/fluted-glass/definition';
import { fluidRippleEffectDefinition } from '$lib/pipelines/effects/fluid-ripple/definition';
import { frostedGlassEffectDefinition } from '$lib/pipelines/effects/frosted-glass/definition';
import { halftoneCmykEffectDefinition } from '$lib/pipelines/effects/halftone-cmyk/definition';
import { halftoneDotsEffectDefinition } from '$lib/pipelines/effects/halftone-dots/definition';
import { heatmapEffectDefinition } from '$lib/pipelines/effects/heatmap/definition';
import { ntscSignalEffectDefinition } from '$lib/pipelines/effects/ntsc-signal/definition';
import { paperGrainEffectDefinition } from '$lib/pipelines/effects/paper-grain/definition';
import { pixelationEffectDefinition } from '$lib/pipelines/effects/pixelation/definition';
import { refractiveLensEffectDefinition } from '$lib/pipelines/effects/refractive-lens/definition';
import { tiledDeformationEffectDefinition } from '$lib/pipelines/effects/tiled-deformation/definition';
import { waterEffectDefinition } from '$lib/pipelines/effects/water/definition';
import { achievementOverlayDefinition } from '$lib/pipelines/overlays/achievement/definition';
import { counterOverlayDefinition } from '$lib/pipelines/overlays/counter/definition';
import { dimensionalTypeOverlayDefinition } from '$lib/pipelines/overlays/dimensional-type/definition';
import { cursorTrailOverlayDefinition } from '$lib/pipelines/overlays/cursor-trail/definition';
import { instagramFollowOverlayDefinition } from '$lib/pipelines/overlays/instagram-follow/definition';
import { instanceStackOverlayDefinition } from '$lib/pipelines/overlays/instance-stack/definition';
import { lowerThirdOverlayDefinition } from '$lib/pipelines/overlays/lower-third/definition';
import { text3dOverlayDefinition } from '$lib/pipelines/overlays/text-3d/definition';
import { tweetStackOverlayDefinition } from '$lib/pipelines/overlays/tweet-stack/definition';
import { shaderFillOverlayDefinition } from '$lib/pipelines/overlays/shader-fill/definition';
import { sourceUrlOverlayDefinition } from '$lib/pipelines/overlays/source-url/definition';
import { washiTapeOverlayDefinition } from '$lib/pipelines/overlays/washi-tape/definition';
import { watermarkOverlayDefinition } from '$lib/pipelines/overlays/watermark/definition';
import { youtubeSubscribeOverlayDefinition } from '$lib/pipelines/overlays/youtube-subscribe/definition';
import { brandMarkSurfaceDefinition } from '$lib/pipelines/surfaces/brand-mark/definition';
import { chapterCardSurfaceDefinition } from '$lib/pipelines/surfaces/chapter-card/definition';
import { checklistSurfaceDefinition } from '$lib/pipelines/surfaces/checklist/definition';
import { imessageSurfaceDefinition } from '$lib/pipelines/surfaces/imessage/definition';
import { newspaperSurfaceDefinition } from '$lib/pipelines/surfaces/newspaper/definition';
import { paperSurfaceDefinition } from '$lib/pipelines/surfaces/paper/definition';
import { plainSurfaceDefinition } from '$lib/pipelines/surfaces/plain/definition';
import { pullquoteOnPhotoSurfaceDefinition } from '$lib/pipelines/surfaces/pullquote-on-photo/definition';
import { titleSequenceSurfaceDefinition } from '$lib/pipelines/surfaces/title-sequence/definition';
import { typeHeroSurfaceDefinition } from '$lib/pipelines/surfaces/type-hero/definition';
import { webDocumentSurfaceDefinition } from '$lib/pipelines/surfaces/web-document/definition';
import { websiteScreenshotSurfaceDefinition } from '$lib/pipelines/surfaces/website-screenshot/definition';
import { boxAnnotationDefinition } from '$lib/pipelines/annotations/box/definition';
import { circleAnnotationDefinition } from '$lib/pipelines/annotations/circle/definition';
import { highlightAnnotationDefinition } from '$lib/pipelines/annotations/highlight/definition';
import { isolateAnnotationDefinition } from '$lib/pipelines/annotations/isolate/definition';
import { liftOutAnnotationDefinition } from '$lib/pipelines/annotations/lift-out/definition';
import { magnifyAnnotationDefinition } from '$lib/pipelines/annotations/magnify/definition';
import { sideNoteAnnotationDefinition } from '$lib/pipelines/annotations/side-note/definition';
import { strikeAnnotationDefinition } from '$lib/pipelines/annotations/strike/definition';
import { tearOutAnnotationDefinition } from '$lib/pipelines/annotations/tear-out/definition';
import { underlineAnnotationDefinition } from '$lib/pipelines/annotations/underline/definition';
import { isAppearanceSlotPackClaimable } from './identity-registry';
import { resolveTypographyColors } from '$lib/platform/packs/resolve';
import type { PackManifest } from '$lib/platform/packs/types';
import type {
	AnnotationPipelineDefinition,
	EffectPipelineDefinition,
	OverlayPipelineDefinition,
	SurfacePipelineDefinition
} from './definition-types';

export const PIPELINE_DEFINITION_REGISTRY = {
	surfaces: {
		paper: paperSurfaceDefinition,
		plain: plainSurfaceDefinition,
		newspaper: newspaperSurfaceDefinition,
		pullquoteOnPhoto: pullquoteOnPhotoSurfaceDefinition,
		chapterCard: chapterCardSurfaceDefinition,
		brandMark: brandMarkSurfaceDefinition,
		titleSequence: titleSequenceSurfaceDefinition,
		typeHero: typeHeroSurfaceDefinition,
		webDocument: webDocumentSurfaceDefinition,
		websiteScreenshot: websiteScreenshotSurfaceDefinition,
		imessage: imessageSurfaceDefinition,
		checklist: checklistSurfaceDefinition
	} satisfies Record<string, SurfacePipelineDefinition>,
	// Like `overlays`, no `satisfies Record<string, BlockDefinition>` — each
	// renderer is generic over its own Block type, and Component props are
	// contravariant, so the specific renderers don't widen. Consumers narrow
	// by `type`.
	blocks: {
		paragraph: paragraphBlockDefinition,
		node: nodeBlockDefinition,
		edgeArrow: edgeArrowBlockDefinition,
		label: labelBlockDefinition,
		statCallout: statCalloutBlockDefinition,
		timelineSegment: timelineSegmentBlockDefinition,
		barChart: barChartBlockDefinition,
		columnChart: columnChartBlockDefinition,
		lineChart: lineChartBlockDefinition,
		unitGridChart: unitGridChartBlockDefinition,
		dotFieldChart: dotFieldChartBlockDefinition
	},
	annotations: {
		highlight: highlightAnnotationDefinition,
		underline: underlineAnnotationDefinition,
		strike: strikeAnnotationDefinition,
		circle: circleAnnotationDefinition,
		box: boxAnnotationDefinition,
		sideNote: sideNoteAnnotationDefinition,
		magnify: magnifyAnnotationDefinition,
		liftOut: liftOutAnnotationDefinition,
		tearOut: tearOutAnnotationDefinition,
		isolate: isolateAnnotationDefinition
	} satisfies Record<string, AnnotationPipelineDefinition>,
	overlays: {
		lowerThird: lowerThirdOverlayDefinition,
		washiTape: washiTapeOverlayDefinition,
		watermark: watermarkOverlayDefinition,
		shaderFill: shaderFillOverlayDefinition,
		cursorTrail: cursorTrailOverlayDefinition,
		counter: counterOverlayDefinition,
		dimensionalType: dimensionalTypeOverlayDefinition,
		instanceStack: instanceStackOverlayDefinition,
		text3d: text3dOverlayDefinition,
		tweetStack: tweetStackOverlayDefinition,
		youtubeSubscribe: youtubeSubscribeOverlayDefinition,
		instagramFollow: instagramFollowOverlayDefinition,
		achievement: achievementOverlayDefinition,
		sourceUrl: sourceUrlOverlayDefinition
	},
	effects: {
		paperGrain: paperGrainEffectDefinition,
		chromaticAberration: chromaticAberrationEffectDefinition,
		crtScreen: crtScreenEffectDefinition,
		crtTube: crtTubeEffectDefinition,
		ntscSignal: ntscSignalEffectDefinition,
		dithering: ditheringEffectDefinition,
		pixelation: pixelationEffectDefinition,
		halftoneDots: halftoneDotsEffectDefinition,
		halftoneCmyk: halftoneCmykEffectDefinition,
		water: waterEffectDefinition,
		flutedGlass: flutedGlassEffectDefinition,
		refractiveLens: refractiveLensEffectDefinition,
		frostedGlass: frostedGlassEffectDefinition,
		fluidRipple: fluidRippleEffectDefinition,
		clothBend: clothBendEffectDefinition,
		tiledDeformation: tiledDeformationEffectDefinition,
		heatmap: heatmapEffectDefinition
	}
};

export const REGISTERED_SURFACE_TYPES = Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces).map(
	(definition) => definition.type
);
export const REGISTERED_BLOCK_TYPES = Object.values(PIPELINE_DEFINITION_REGISTRY.blocks).map(
	(definition) => definition.type
);
export const REGISTERED_OVERLAY_TYPES = Object.values(PIPELINE_DEFINITION_REGISTRY.overlays).map(
	(definition) => definition.type
);
export const REGISTERED_EFFECT_TYPES = Object.values(PIPELINE_DEFINITION_REGISTRY.effects).map(
	(definition) => definition.type
);

export function getSurfaceDefinition(type: string): SurfacePipelineDefinition | null {
	return (
		Object.values(PIPELINE_DEFINITION_REGISTRY.surfaces).find(
			(definition) => definition.type === type
		) ?? null
	);
}

export function getOverlayDefinition(type: string): OverlayPipelineDefinition | null {
	const definition = Object.values(PIPELINE_DEFINITION_REGISTRY.overlays).find(
		(candidate) => candidate.type === type
	);
	return definition ? (definition as unknown as OverlayPipelineDefinition) : null;
}

export function getEffectDefinition(type: string): EffectPipelineDefinition | null {
	return (
		Object.values(PIPELINE_DEFINITION_REGISTRY.effects).find(
			(definition) => definition.type === type
		) ?? null
	);
}

export function resolveSurfaceTypographyColors(
	pack: PackManifest,
	surfaceType: string,
	typography: { paperColor?: string; inkColor?: string }
): { paperColor: string; inkColor: string } {
	const substrate = getSurfaceDefinition(surfaceType)?.substrateColors;
	const surfaceKey = `surface:${surfaceType}`;
	const paperImmune = substrate && !isAppearanceSlotPackClaimable(surfaceKey, 'fill');
	const inkImmune = substrate && !isAppearanceSlotPackClaimable(surfaceKey, 'ink');
	const packResolved = resolveTypographyColors(pack, typography);
	return {
		paperColor:
			typography.paperColor ?? (paperImmune ? substrate.paperHex : packResolved.paperColor),
		inkColor: typography.inkColor ?? (inkImmune ? substrate.inkHex : packResolved.inkColor)
	};
}
