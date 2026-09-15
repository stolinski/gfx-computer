import type { z } from 'zod';

import { validateChartGroupSemantics } from './chart-validation';
import { validateKineticTypeFieldSemantics } from './kinetic-type-field-validation';
import { STAGE_POSED_OVERLAY_LIMIT, type Preset } from './engine-schema';
import { findPack, listRuntimeUserPacks, PACK_REGISTRY } from './packs/registry';
import { PACK_SLUG_PATTERN } from './packs/types';
import {
	getEffectDefinition,
	getOverlayDefinition,
	getSurfaceDefinition
} from './pipelines/definition-registry';
import { getCompositionEffectRegistration } from './pipelines/composition-effect-registry';
import { STAGE_BODY_CEILINGS } from './pipelines/depth-stage-geometry';
import { partitionStageOverlays } from './pipelines/depth-stage-planes';
import { getStageRegistration } from './pipelines/stage-registry';
import {
	getTransitionEffectDefinition,
	isTransitionEffectType
} from './pipelines/transition-definition-registry';
import { isCaptureAsset, listCaptureAssets } from './capture-assets';
import { isStageModel, listStageModels } from './stage-models';
import { isSubstrateAsset } from './substrate-textures';
import { resolveFrameRate, secondsToFrames } from '../utils/composition-timing';
import { normalizeWebsiteCaptureUrl } from '../utils/website-showcase';
import { TEXT_EFFECT_CATALOG } from '../text-animations/catalog';
import { textEffectUnavailableReason } from '../text-animations/availability';

export interface PresetSemanticIssue {
	path: (string | number)[];
	message: string;
}

export interface PresetSemanticValidationOptions {
	resolvePreset?: (slug: string) => Preset | null;
	/**
	 * Which `pack` slugs pass (ADR-0055):
	 * - `registry` (default): PACK_REGISTRY alone — every deliverable gate.
	 * - `runtime`: the registry plus the User Packs loaded into this engine — the
	 *   open document and any draft an operation is about to apply, which loads
	 *   the pack through `ensurePackLoaded` first.
	 * - `stored`: the registry plus any well-formed User Pack slug — the
	 *   composition store's own documents, which must stay loadable when the
	 *   pack they name is gone so the author can rebind rather than lose them;
	 *   the absent pack fails at resolution, with its slug named.
	 */
	packScope?: 'registry' | 'runtime' | 'stored';
}

function appendSchemaIssues(
	issues: PresetSemanticIssue[],
	prefix: (string | number)[],
	error: z.ZodError
): void {
	for (const issue of error.issues) {
		issues.push({
			path: [
				...prefix,
				...issue.path.map((part) =>
					typeof part === 'symbol' ? (part.description ?? part.toString()) : part
				)
			],
			message: issue.message
		});
	}
}

function validateUniqueIds(
	items: readonly { id: string }[],
	path: 'overlays' | 'effects',
	issues: PresetSemanticIssue[]
): void {
	const seen = new Set<string>();
	for (const [index, item] of items.entries()) {
		if (item.id.length === 0) {
			issues.push({ path: ['state', path, index, 'id'], message: 'ID must not be empty' });
		} else if (seen.has(item.id)) {
			issues.push({
				path: ['state', path, index, 'id'],
				message: `Duplicate ${path === 'overlays' ? 'overlay' : 'effect'} ID "${item.id}"`
			});
		}
		seen.add(item.id);
	}
}

function validateMediaSemantics(preset: Preset, issues: PresetSemanticIssue[]): void {
	const assetIds = new Set<string>();
	for (const [index, asset] of preset.state.media.assets.entries()) {
		if (assetIds.has(asset.id)) {
			issues.push({
				path: ['state', 'media', 'assets', index, 'id'],
				message: `Duplicate Video asset ID "${asset.id}"`
			});
		}
		assetIds.add(asset.id);
	}

	const clipIds = new Set<string>();
	const clips = preset.state.media.videoTrack.clips;
	const compositionFrameCount = Math.max(
		1,
		secondsToFrames(
			preset.state.transport.durationSeconds,
			resolveFrameRate(preset.state.transport.fps)
		)
	);
	for (const [index, clip] of clips.entries()) {
		if (clipIds.has(clip.id)) {
			issues.push({
				path: ['state', 'media', 'videoTrack', 'clips', index, 'id'],
				message: `Duplicate Video clip ID "${clip.id}"`
			});
		}
		clipIds.add(clip.id);

		if (!assetIds.has(clip.assetId)) {
			issues.push({
				path: ['state', 'media', 'videoTrack', 'clips', index, 'assetId'],
				message: `Video clip "${clip.id}" references missing asset "${clip.assetId}"`
			});
		}

		const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
		if (clipEndFrame > compositionFrameCount) {
			issues.push({
				path: ['state', 'media', 'videoTrack', 'clips', index, 'durationFrames'],
				message: `Video clip "${clip.id}" ends at frame ${clipEndFrame}, beyond the composition's ${compositionFrameCount} frames`
			});
		}

		const previous = clips[index - 1];
		if (
			previous &&
			previous.timelineStartFrame + previous.durationFrames > clip.timelineStartFrame
		) {
			issues.push({
				path: ['state', 'media', 'videoTrack', 'clips', index, 'timelineStartFrame'],
				message: `Video clips must be ordered and non-overlapping; "${clip.id}" starts before "${previous.id}" ends`
			});
		}
	}
}

function validatePackSemantics(
	preset: Preset,
	options: PresetSemanticValidationOptions,
	issues: PresetSemanticIssue[]
): void {
	if (preset.pack in PACK_REGISTRY) return;
	const scope = options.packScope ?? 'registry';
	if (scope === 'stored' && PACK_SLUG_PATTERN.test(preset.pack)) return;
	if (scope === 'runtime' && findPack(preset.pack) !== null) return;
	const registered = Object.keys(PACK_REGISTRY).join(', ');
	const loaded = listRuntimeUserPacks().map((pack) => pack.slug);
	issues.push({
		path: ['pack'],
		message:
			scope === 'stored'
				? `Pack "${preset.pack}" is neither a registered Pack (${registered}) nor a valid User Pack slug`
				: scope === 'runtime'
					? `Pack "${preset.pack}" is not a registered Pack (${registered}) and is not loaded from the User Pack store${loaded.length > 0 ? ` (loaded: ${loaded.join(', ')})` : ''}`
					: `Unknown Pack "${preset.pack}". Registered Packs: ${registered}`
	});
}

function validateSurfaceSemantics(preset: Preset, issues: PresetSemanticIssue[]): void {
	const surfaceDefinition = getSurfaceDefinition(preset.state.surface.type);
	if (!surfaceDefinition) {
		issues.push({
			path: ['state', 'surface', 'type'],
			message: `Unknown Surface type "${preset.state.surface.type}"`
		});
	} else if (preset.state.surface.variant !== undefined) {
		if (!surfaceDefinition.variantIds) {
			issues.push({
				path: ['state', 'surface', 'variant'],
				message: `Surface "${surfaceDefinition.type}" does not support variants`
			});
		} else if (!surfaceDefinition.variantIds.includes(preset.state.surface.variant)) {
			issues.push({
				path: ['state', 'surface', 'variant'],
				message: `Unknown variant "${preset.state.surface.variant}" for Surface "${surfaceDefinition.type}". Registered variants: ${surfaceDefinition.variantIds.join(', ')}`
			});
		}
	}

	if (preset.state.surface.type === 'website-screenshot') {
		const { imageUrl, captureAsset } = preset.state.surface.content;
		// One capture source: the local user-asset store (GUI authoring) or a
		// bundled capture (corpus deliverables, ADR-0057) — never both, never none.
		if (imageUrl !== undefined && captureAsset !== undefined) {
			issues.push({
				path: ['state', 'surface', 'content', 'captureAsset'],
				message:
					'website-screenshot takes one capture source: remove either imageUrl or captureAsset'
			});
		} else if (captureAsset !== undefined) {
			if (!isCaptureAsset(captureAsset)) {
				issues.push({
					path: ['state', 'surface', 'content', 'captureAsset'],
					message: `Unknown capture asset "${captureAsset}". Bundled captures: ${listCaptureAssets().join(', ')}`
				});
			}
		} else if (!imageUrl || !/^\/api\/user-assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(imageUrl)) {
			issues.push({
				path: ['state', 'surface', 'content', 'imageUrl'],
				message:
					'website-screenshot requires a content-addressed /api/user-assets imageUrl or a bundled captureAsset'
			});
		}
		try {
			normalizeWebsiteCaptureUrl(preset.state.surface.content.sourceUrl ?? '');
		} catch (errorValue) {
			issues.push({
				path: ['state', 'surface', 'content', 'sourceUrl'],
				message: errorValue instanceof Error ? errorValue.message : 'Website capture URL is invalid'
			});
		}
	}

	for (const issue of validateChartGroupSemantics(
		preset.state.surface.chart,
		preset.state.surface.diagram ?? [],
		preset.state.surface.type
	)) {
		issues.push({
			path: ['state', 'surface', ...issue.path],
			message: issue.message
		});
	}

	for (const issue of validateKineticTypeFieldSemantics(
		preset.state.surface.typeField,
		preset.state.surface,
		preset.state.stage !== undefined
	)) {
		issues.push({
			path: ['state', 'surface', 'typeField', ...issue.path],
			message: issue.message
		});
	}
}

/** Returns the overlay ID set for text-animation target checks. */
function validateOverlaySemantics(preset: Preset, issues: PresetSemanticIssue[]): Set<string> {
	validateUniqueIds(preset.state.overlays, 'overlays', issues);
	const overlayIds = new Set<string>();
	for (const [index, overlay] of preset.state.overlays.entries()) {
		overlayIds.add(overlay.id);
		const definition = getOverlayDefinition(overlay.type);
		if (!definition) {
			issues.push({
				path: ['state', 'overlays', index, 'type'],
				message: `Unknown Overlay type "${overlay.type}"`
			});
			continue;
		}
		const result = definition.schema.safeParse(overlay.content);
		if (!result.success) {
			appendSchemaIssues(issues, ['state', 'overlays', index, 'content'], result.error);
		}
	}
	return overlayIds;
}

function validateEffectSemantics(preset: Preset, issues: PresetSemanticIssue[]): void {
	validateUniqueIds(preset.state.effects, 'effects', issues);
	for (const [index, effect] of preset.state.effects.entries()) {
		if (isTransitionEffectType(effect.type)) {
			issues.push({
				path: ['state', 'effects', index, 'type'],
				message: `Transition Effect "${effect.type}" belongs in the top-level transition block, not effects[]`
			});
			continue;
		}

		const definition = getEffectDefinition(effect.type);
		const compositionRegistration = getCompositionEffectRegistration(effect.type);
		const schema = definition?.schema ?? compositionRegistration?.schema;
		if (!schema) {
			issues.push({
				path: ['state', 'effects', index, 'type'],
				message: `Unknown Effect type "${effect.type}"`
			});
			continue;
		}
		const result = schema.safeParse(effect);
		if (!result.success) {
			appendSchemaIssues(issues, ['state', 'effects', index], result.error);
		}
	}
}

function validateStageSemantics(preset: Preset, issues: PresetSemanticIssue[]): void {
	if (!preset.state.stage) return;
	if (!getStageRegistration(preset.state.stage.type)) {
		issues.push({
			path: ['state', 'stage', 'type'],
			message: `Unknown Stage type "${preset.state.stage.type}"`
		});
	}
	const asset = preset.state.stage.backdrop?.image?.asset;
	if (asset && !isSubstrateAsset(asset)) {
		issues.push({
			path: ['state', 'stage', 'backdrop', 'image', 'asset'],
			message: `Unknown substrate asset "${asset}"`
		});
	}
	// The physical screen (ADR-0051 phase 2) must be a registered model.
	const screenModel = preset.state.stage?.screen?.model;
	if (screenModel !== undefined && !isStageModel(screenModel)) {
		issues.push({
			path: ['state', 'stage', 'screen', 'model'],
			message: `Unknown stage model "${screenModel}". Registered models: ${listStageModels().join(', ')}`
		});
	}
	// Each posed Overlay (an explicit z or a pose) rides its own capture plane
	// (ADR-0057); the stage allocates at most STAGE_POSED_OVERLAY_LIMIT of them.
	const { posed, bodies } = partitionStageOverlays(preset.state.overlays);
	// Each body Overlay (ADR-0062) and the screen take one of the stage's body
	// slots; the ceiling is the pool of body uniforms.
	const bodyCount = bodies.length + (preset.state.stage?.screen ? 1 : 0);
	if (bodyCount > STAGE_BODY_CEILINGS.maxBodies) {
		const overflow = bodies[STAGE_BODY_CEILINGS.maxBodies - (preset.state.stage?.screen ? 1 : 0)];
		issues.push({
			path: ['state', 'overlays', preset.state.overlays.indexOf(overflow)],
			message: `The depth stage carries at most ${STAGE_BODY_CEILINGS.maxBodies} bodies, the screen included; "${overflow.id}" is one more. Remove a body Overlay or the screen.`
		});
	}
	if (posed.length > STAGE_POSED_OVERLAY_LIMIT) {
		const overflow = posed[STAGE_POSED_OVERLAY_LIMIT];
		issues.push({
			path: ['state', 'overlays', preset.state.overlays.indexOf(overflow)],
			message: `The depth stage carries at most ${STAGE_POSED_OVERLAY_LIMIT} posed Overlays (an explicit z or a pose); "${overflow.id}" is one more. Remove its z and pose so it shares the Overlay plane, or remove another posed Overlay.`
		});
	}
}

function validateTextAnimationTargets(
	preset: Preset,
	overlayIds: ReadonlySet<string>,
	issues: PresetSemanticIssue[]
): void {
	const pack = findPack(preset.pack);
	for (const [index, animation] of preset.state.textAnimations.entries()) {
		if (animation.target.kind === 'overlay' && !overlayIds.has(animation.target.overlayId)) {
			issues.push({
				path: ['state', 'textAnimations', index, 'target', 'overlayId'],
				message: `Overlay target "${animation.target.overlayId}" does not match any overlays[].id`
			});
		}

		const effect = TEXT_EFFECT_CATALOG.get(animation.effect);
		if (!effect?.requiresVariableWeight || pack === null) continue;
		const targetOverlayId = animation.target.kind === 'overlay' ? animation.target.overlayId : null;
		const targetOverlay =
			targetOverlayId === null
				? undefined
				: preset.state.overlays.find((candidate) => candidate.id === targetOverlayId);
		const pipelineKey =
			animation.target.kind === 'surface'
				? `surface:${preset.state.surface.type}`
				: targetOverlay
					? `overlay:${targetOverlay.type}`
					: null;
		if (pipelineKey === null) continue;
		const reason = textEffectUnavailableReason(effect, {
			slotKey:
				animation.target.kind === 'surface'
					? animation.target.slot
					: `overlay:${animation.target.slot}`,
			pipelineKey,
			pack
		});
		if (reason === 'variable-weight-unavailable') {
			issues.push({
				path: ['state', 'textAnimations', index, 'effect'],
				message: `Text effect "${animation.effect}" requires Pack "${preset.pack}" to declare a real variable-weight-treatment.`
			});
		} else if (reason === 'pack-appearance-blocked') {
			issues.push({
				path: ['state', 'textAnimations', index, 'effect'],
				message: `Text effect "${animation.effect}" cannot target Pack-immune ${pipelineKey}; its variable face is a Pack appearance claim.`
			});
		}
	}
}

function validateTransitionSemantics(
	preset: Preset,
	options: PresetSemanticValidationOptions,
	issues: PresetSemanticIssue[]
): void {
	if (!preset.transition) return;
	if (preset.state.media.videoTrack.clips.length > 0) {
		issues.push({
			path: ['state', 'media', 'videoTrack', 'clips'],
			message: 'Active Video clips are not supported on transition Presets in v1'
		});
	}
	const definition = getTransitionEffectDefinition(preset.transition.effect);
	if (!definition) {
		issues.push({
			path: ['transition', 'effect'],
			message: `Unknown transition Effect "${preset.transition.effect}"`
		});
	} else if (!definition.paramsSchema) {
		// HMR can expose a definition before all of its exports have reinitialized.
		// Reject that transient definition instead of crashing catalog module evaluation.
		issues.push({
			path: ['transition', 'effect'],
			message: `Transition Effect "${definition.type}" definition is missing its parameter schema`
		});
	} else {
		const result = definition.paramsSchema.safeParse(preset.transition.params);
		if (!result.success) {
			appendSchemaIssues(issues, ['transition', 'params'], result.error);
		}
	}
	if (!options.resolvePreset) return;
	for (const endpoint of ['from', 'to'] as const) {
		const slug = preset.transition[endpoint];
		const resolved = options.resolvePreset(slug);
		if (!resolved) {
			issues.push({
				path: ['transition', endpoint],
				message: `Preset "${slug}" does not resolve`
			});
		} else if (resolved.state.media.videoTrack.clips.length > 0) {
			issues.push({
				path: ['transition', endpoint],
				message: `Preset "${slug}" uses active Video clips, which transition snapshots do not support in v1`
			});
		}
	}
}

export function validatePresetSemantics(
	preset: Preset,
	options: PresetSemanticValidationOptions = {}
): readonly PresetSemanticIssue[] {
	const issues: PresetSemanticIssue[] = [];

	validatePackSemantics(preset, options, issues);
	validateMediaSemantics(preset, issues);
	validateSurfaceSemantics(preset, issues);
	const overlayIds = validateOverlaySemantics(preset, issues);
	validateEffectSemantics(preset, issues);
	validateStageSemantics(preset, issues);
	validateTextAnimationTargets(preset, overlayIds, issues);
	validateTransitionSemantics(preset, options, issues);

	return issues;
}

export function formatPresetSemanticIssues(issues: readonly PresetSemanticIssue[]): string {
	return issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('\n');
}
