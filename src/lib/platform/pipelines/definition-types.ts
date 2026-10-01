import type { z } from 'zod';

import type { AnnotationBodyBlockType } from '$lib/annotations/annotation-marks';
import type { AnnotationMarkStyle } from '$lib/annotations/annotation-mark-styles';
import type {
	Keyframe,
	OverlayPosition,
	SurfaceState,
	Transition
} from '$lib/platform/engine-schema';
import type { PackManifest } from '$lib/platform/packs/types';
import type { EdgeTreatment } from '$lib/platform/packs/resolve';
import type {
	AnnotationKind,
	OverlayDefaults,
	RendererReadableTextContext,
	RendererReadableTextContract,
	SurfaceControlsMetadata
} from './types';

export interface SurfacePipelineDefinition {
	type: string;
	label: string;
	controls: SurfaceControlsMetadata;
	variantIds?: readonly string[];
	defaults(): SurfaceState;
	edgeTreatment?: boolean;
	intrinsicEdgeTreatment?: EdgeTreatment;
	substrateColors?: { paperHex: string; inkHex: string };
	disablePackMaterial?: boolean;
	/**
	 * The CanvasSource renders `content.title` through the bracket-tag mark
	 * parser as `data-annotation-mark` spans, so a headline can carry a
	 * highlighter. `listSurfaceMarkInstances` then enumerates the title's marks
	 * BEFORE the body's (document order) and `marks.timings[]` indexes them the
	 * same way. Absent: the title prints plain and mark syntax in it is a lint
	 * error (rubric A3).
	 */
	titleMarks?: boolean;
}

export interface PipelineSchemaDefinition {
	safeParse(
		value: unknown
	): { success: true; data: unknown } | { success: false; error: z.ZodError };
}

export interface BlockPipelineDefinition<TType extends string = string> {
	type: TType;
	schema?: PipelineSchemaDefinition;
}

export interface AnnotationPipelineDefinition {
	style: AnnotationMarkStyle;
	kind: AnnotationKind;
	appliesTo: readonly (AnnotationBodyBlockType | 'block')[];
}

export interface OverlayPipelineDefinition<TContent = unknown> {
	type: string;
	label: string;
	schema: PipelineSchemaDefinition;
	defaults(): OverlayDefaults<TContent>;
	readableText?: (
		content: TContent,
		context: RendererReadableTextContext
	) => readonly RendererReadableTextContract[];
	fieldInkOnBackground?: boolean;
	disableEntryOffset?: boolean;
	disableOpacityTransition?: boolean;
	edgeTransition?: 'right';
	/**
	 * This Overlay renders on the depth Stage as a BODY (ADR-0051, ADR-0062):
	 * its renderer contributes geometry instead of captured pixels, so the
	 * stage keeps it out of every captured plane and the canvas selects it by
	 * its projected silhouette. Off the stage its CanvasSource is the flat
	 * fallback. Declared here, renderer-free, so partition and validation can
	 * see it without loading the renderer.
	 */
	stageBody?: true;
}

export interface EffectPipelineDefinition<TParams = unknown> {
	type: string;
	label: string;
	schema: PipelineSchemaDefinition;
	defaults(): { params: TParams };
	isPackInert?(pack: PackManifest): boolean;
	/**
	 * Dotted paths of numeric params that never become keyframe channels
	 * (ADR-0063 §3). Every other numeric leaf of `schema`'s params is a channel;
	 * a definition may only subtract. Freeze a param that seeds a fixed-step
	 * simulation, a replay, or a hash: every `seed`, and every input the
	 * simulation kernel reads (step-function constants and authored events).
	 * `SeekableSimulationRuntime` continues forward seeks from its current
	 * state, so a kernel input that changed mid-run would make a jump-seek and a
	 * play-through disagree. GPU-side params of the same Effect stay channels.
	 */
	frozenParams?: readonly string[];
	/**
	 * Keyframe tracks this Effect's own timing fields expand into when the
	 * animation manifest is built (ADR-0063 §8), the way `enter` / `exit` sugar
	 * expands for an Overlay. Keyed by channel path; `atMs` counts from
	 * composition start. A channel the composition declares takes the pen, so
	 * its sugar track is dropped. `params` arrive with schema defaults filled.
	 */
	keyframeSugar?(params: TParams, durationMs: number): Partial<Record<string, Keyframe[]>>;
}

export interface TransitionEffectDefinition<TParams = unknown> {
	type: string;
	label: string;
	paramsSchema: PipelineSchemaDefinition;
	defaults(): { params: TParams };
}

export interface OverlayDefinitionDefaults<TContent = unknown> {
	content: TContent;
	position: OverlayPosition;
	enter?: Transition;
	exit?: Transition;
}
