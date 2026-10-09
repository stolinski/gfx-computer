import {
	type Cascade,
	type CascadeAnchor,
	type CompositionTransition,
	type Effect,
	type Keyframe,
	type MarkTiming,
	type Overlay,
	type OverlayAnimation,
	type Preset,
	type SurfaceAnimation,
	type SurfaceState,
	type TextAnimation,
	type Transition
} from './engine-schema';
import { cloneOverlayPlacement } from '../utils/overlay-placement';
import { cloneJsonValue } from '../utils/json-clone';
import { compositionEditHistory } from './composition-edit-history';
import { filmFromPreset } from './film-ingress';
import { holdOpenFilmDocument } from './film-state.svelte';
import {
	legacyPresetEnvelopeFromPreset,
	openFilmDocumentFromFilm,
	selectedScenePresetOfOpenFilm,
	type LegacyPresetEnvelope,
	type OpenFilmDocument
} from './open-film-document';
import { getPresetBySlug } from './preset-catalog';
import {
	engineState,
	packState,
	transitionState,
	type ResolvedTransition
} from './engine-state.svelte';
import { applyPresetBase } from './preset-base.svelte';
import { isTransitionEffectType } from './pipelines/transition-definition-registry';

import type { Film, FilmSceneOrigin } from './film-schema';

function cloneCascadeAnchor(anchor: CascadeAnchor): CascadeAnchor {
	if (anchor === 'surface') {
		return anchor;
	}
	if ('overlay' in anchor) {
		return { overlay: anchor.overlay };
	}
	if ('mark' in anchor) {
		return { mark: anchor.mark };
	}
	if ('block' in anchor) {
		return { block: anchor.block };
	}
	return { textAnimation: anchor.textAnimation };
}

function cloneCascade(cascade: Cascade): Cascade {
	return {
		anchor: cloneCascadeAnchor(cascade.anchor),
		event: cascade.event,
		offsetMs: cascade.offsetMs
	};
}

// Clones every declared channel track without hand-enumerating channel names —
// a fixed list here would silently drop any channel the schema grows later
// (the same trap that lost `counterpoint` in cloneSurface).
function cloneChannelKeyframes<T extends Record<string, Keyframe[] | undefined>>(channels: T): T {
	const next = { ...channels };
	for (const key of Object.keys(next) as (keyof T)[]) {
		const track = next[key];
		if (track) {
			next[key] = track.map((frame) => ({ ...frame })) as T[keyof T];
		}
	}
	return next;
}

function cloneOverlayAnimation(animation: OverlayAnimation): OverlayAnimation {
	const next: OverlayAnimation = {
		channels: animation.channels ? cloneChannelKeyframes(animation.channels) : undefined,
		cascade: animation.cascade ? cloneCascade(animation.cascade) : undefined
	};
	// Per-orientation spatial groups (ADR-0039 §4); absent stays absent so an
	// unchanged Preset serializes byte-identical.
	if (animation.orientationOverrides) {
		next.orientationOverrides = cloneJsonValue(animation.orientationOverrides);
	}
	return next;
}

function cloneSurfaceAnimation(animation: SurfaceAnimation): SurfaceAnimation {
	return {
		channels: animation.channels ? cloneChannelKeyframes(animation.channels) : undefined
	};
}

function cloneTiming(timing: MarkTiming): MarkTiming {
	const next: MarkTiming = {
		start: timing.start,
		duration: timing.duration,
		ease: timing.ease
	};

	if (timing.color !== undefined) {
		next.color = timing.color;
	}

	if (timing.intensity !== undefined) {
		next.intensity = timing.intensity;
	}

	if (timing.sound !== undefined) {
		next.sound = { ...timing.sound };
	}

	if (timing.cascade !== undefined) {
		next.cascade = cloneCascade(timing.cascade);
	}

	return next;
}

// Clones the nested per-motion sound override too — sharing it by reference
// would let GUI edits on the live engine state mutate the catalogued Preset.
function cloneTransition(transition: Transition): Transition {
	return {
		...transition,
		sound: transition.sound ? { ...transition.sound } : undefined
	};
}

function cloneSurface(surface: SurfaceState): SurfaceState {
	return {
		type: surface.type,
		// Spread every content slot — a hand-enumerated list silently drops new
		// fields (it had already lost `counterpoint`, degrading every type-hero
		// `pair` preset to the `single` fallback). `body` is a parsed structure
		// shared by reference, matching the prior behavior.
		content: cloneJsonValue(surface.content),
		// Which site the `web-document` Surface mocks (twitter | reddit |
		// wikipedia). A top-level surface field like `variant` — must be carried
		// here or applyPreset silently drops it and every site falls back to the
		// `twitter` mock (the same hand-enumeration trap that lost `counterpoint`).
		site: surface.site,
		variant: surface.variant,
		// Chrome mode (ADR-0037): another top-level surface field that must be
		// carried explicitly, or chromeless presets silently render the window.
		chrome: surface.chrome,
		// The filmed framing's page anchor (ADR-0057): the same top-level trap.
		pageAnchor: surface.pageAnchor ? { ...surface.pageAnchor } : undefined,
		pageAnchorOrientationOverrides: surface.pageAnchorOrientationOverrides
			? cloneJsonValue(surface.pageAnchorOrientationOverrides)
			: undefined,
		checklistCard: surface.checklistCard ? { ...surface.checklistCard } : undefined,
		checklistCardOrientationOverrides: surface.checklistCardOrientationOverrides
			? cloneJsonValue(surface.checklistCardOrientationOverrides)
			: undefined,
		enter: surface.enter ? cloneTransition(surface.enter) : undefined,
		exit: surface.exit ? cloneTransition(surface.exit) : undefined,
		animation: surface.animation ? cloneSurfaceAnimation(surface.animation) : undefined,
		backgroundVisibility: surface.backgroundVisibility,
		// Diagram primitive Blocks (ADR-0036). Pure JSON (points, strings, numbers,
		// transitions, channel tracks), so structuredClone deep-copies every field
		// without the hand-enumeration trap that lost `counterpoint` and `chrome`.
		diagram: surface.diagram ? cloneJsonValue(surface.diagram) : undefined,
		// Chart Blocks (ADR-0048) are the same pure JSON contract. Clone the
		// complete group so applyPreset cannot share mutable data with catalog or wire input.
		chart: surface.chart ? cloneJsonValue(surface.chart) : undefined,
		// Type Field words and semantic phrases (ADR-0064) are one atomic Surface group.
		typeField: surface.typeField ? cloneJsonValue(surface.typeField) : undefined,
		// Figures (ADR-0067) are pure JSON declarations; clone the whole group.
		figures: surface.figures ? cloneJsonValue(surface.figures) : undefined
	};
}

function cloneOverlay(overlay: Overlay): Overlay {
	return {
		type: overlay.type,
		id: overlay.id,
		content: cloneJsonValue(overlay.content),
		position: {
			...cloneOverlayPlacement(overlay.position),
			orientationOverrides: overlay.position.orientationOverrides
				? {
						horizontal: overlay.position.orientationOverrides.horizontal
							? cloneOverlayPlacement(overlay.position.orientationOverrides.horizontal)
							: undefined,
						vertical: overlay.position.orientationOverrides.vertical
							? cloneOverlayPlacement(overlay.position.orientationOverrides.vertical)
							: undefined
					}
				: undefined
		},
		enter: overlay.enter ? cloneTransition(overlay.enter) : undefined,
		exit: overlay.exit ? cloneTransition(overlay.exit) : undefined,
		animation: overlay.animation ? cloneOverlayAnimation(overlay.animation) : undefined,
		z: overlay.z,
		// The posed plane (ADR-0057) rides with its depth.
		pose: overlay.pose ? { ...overlay.pose } : undefined
	};
}

function cloneEffect(effect: Effect): Effect {
	const next: Effect = { type: effect.type, id: effect.id, params: cloneJsonValue(effect.params) };
	// Keyframed Effect params (ADR-0063). The key stays absent when undeclared so
	// a static Effect serializes exactly as before.
	if (effect.animation) next.animation = cloneJsonValue(effect.animation);
	return next;
}

function cloneTextAnimation(entry: TextAnimation): TextAnimation {
	const target =
		entry.target.kind === 'surface'
			? { kind: 'surface' as const, slot: entry.target.slot }
			: {
					kind: 'overlay' as const,
					overlayId: entry.target.overlayId,
					slot: entry.target.slot
				};

	return {
		id: entry.id,
		target,
		effect: entry.effect,
		enter: cloneTransition(entry.enter),
		exit: entry.exit ? cloneTransition(entry.exit) : undefined,
		cascade: entry.cascade ? cloneCascade(entry.cascade) : undefined,
		params: entry.params ? { ...entry.params } : undefined
	};
}

/**
 * Apply a Preset's composition (its Pack + `state`) to the live engine state.
 * Does NOT touch `transitionState` — the transition snapshot path swaps the
 * composition to `from`/`to` through this without disturbing the transition it
 * is servicing. Callers wanting the full "load this Preset" behaviour (including
 * resolving a transition recipe) use `applyPreset`.
 */
export function applyCompositionState(preset: Preset): void {
	const next = preset.state;

	packState.slug = preset.pack;

	engineState.transport.orientation = next.transport.orientation;
	engineState.transport.durationSeconds = next.transport.durationSeconds;
	engineState.transport.fps = next.transport.fps;
	engineState.transport.format = next.transport.format;
	// Optional: absent means the poster frame is chosen by content (ADR-0061),
	// and the key must be absent rather than undefined so the wire format and
	// its content hash stay identical to the document's.
	if (next.transport.posterSeconds === undefined) {
		delete engineState.transport.posterSeconds;
	} else {
		engineState.transport.posterSeconds = next.transport.posterSeconds;
	}

	engineState.typography.fontFamily = next.typography.fontFamily;
	engineState.typography.paperColor = next.typography.paperColor;
	engineState.typography.inkColor = next.typography.inkColor;

	for (const style of Object.keys(
		engineState.marks.defaults
	) as (keyof typeof engineState.marks.defaults)[]) {
		if (!(style in next.marks.defaults)) {
			delete engineState.marks.defaults[style];
		}
	}
	for (const [style, appearance] of Object.entries(next.marks.defaults)) {
		engineState.marks.defaults[style as keyof typeof engineState.marks.defaults] = {
			color: appearance.color,
			intensity: appearance.intensity
		};
	}

	engineState.marks.timings.length = 0;
	for (const timing of next.marks.timings) {
		engineState.marks.timings.push(cloneTiming(timing));
	}

	engineState.surface = cloneSurface(next.surface);
	engineState.overlays = next.overlays.map(cloneOverlay);
	engineState.effects = (next.effects ?? []).map(cloneEffect);
	engineState.textAnimations = (next.textAnimations ?? []).map(cloneTextAnimation);
	engineState.audioCues = next.audioCues.map((cue) => ({ ...cue }));
	engineState.media = cloneJsonValue(next.media);
	engineState.backgroundFill = next.backgroundFill;
	engineState.stage = next.stage
		? {
				type: next.stage.type,
				camera: { ...next.stage.camera },
				focus: {
					...next.stage.focus,
					pull: next.stage.focus.pull ? { ...next.stage.focus.pull } : undefined
				},
				backdrop: next.stage.backdrop
					? {
							image: next.stage.backdrop.image ? { ...next.stage.backdrop.image } : undefined,
							contrast: next.stage.backdrop.contrast
						}
					: undefined,
				screen: next.stage.screen ? { model: next.stage.screen.model } : undefined
			}
		: undefined;
	// Captions track (creator blocks): pure JSON (style knobs + ms cues), so
	// structuredClone deep-copies every field without the hand-enumeration trap.
	engineState.captions = next.captions ? cloneJsonValue(next.captions) : undefined;
	// Motion Beats (ADR-0064): pure JSON time anchors.
	engineState.motionBeats = next.motionBeats ? cloneJsonValue(next.motionBeats) : undefined;
}

/**
 * Resolve a transition recipe into the form `transitionState.active` carries:
 * `from`/`to` slugs resolved against the built-in catalog, `effect` checked
 * against the transition registry. Returns null when the recipe is absent or
 * any reference fails to resolve — the "no active transition" state, never a
 * throw. Shared by `applyPreset` (load) and the RootInspector's Transition
 * section (live edits), so both paths resolve identically.
 */
export function resolveTransition(
	recipe: CompositionTransition | undefined
): ResolvedTransition | null {
	if (!recipe) return null;
	const from = getPresetBySlug(recipe.from);
	const to = getPresetBySlug(recipe.to);
	if (!from || !to || !isTransitionEffectType(recipe.effect)) return null;
	return {
		fromSlug: recipe.from,
		toSlug: recipe.to,
		from,
		to,
		effect: recipe.effect,
		durationMs: recipe.durationMs,
		params: cloneJsonValue(recipe.params)
	};
}

/**
 * Replace the open Film with `document` (ADR-0068 §8): hold the Film beside
 * engine state (`filmState`), then write its selected Scene into live state —
 * the Pack and the Scene's `state`, the Film's name and description, and the
 * legacy envelope's `kind` and transition recipe, resolved for the Workspace.
 *
 * It keeps the shared history: an edit, its undo, and its redo are all points
 * in one open document's life. Opening a different Film is `applyFilm`.
 */
export function applyOpenFilmDocument(document: OpenFilmDocument): void {
	holdOpenFilmDocument(document);
	const scenePreset = selectedScenePresetOfOpenFilm(document);
	applyCompositionState(scenePreset);
	applyPresetBase(scenePreset);
	transitionState.active = resolveTransition(scenePreset.transition);
}

/**
 * Open a Film with its first Scene selected. Clears the shared history, so the
 * Composition revision restarts: a revision names a point in one open Film's
 * life. `legacyPresetEnvelope` carries the two Preset fields a Film does not
 * hold yet (`./open-film-document.ts`).
 */
export function applyFilm(film: Film, legacyPresetEnvelope: LegacyPresetEnvelope): void {
	compositionEditHistory.clear();
	applyOpenFilmDocument(openFilmDocumentFromFilm(film, legacyPresetEnvelope));
}

/**
 * Open a Preset as an unsaved one-Scene Film (`filmFromPreset`), with its
 * `kind` and transition recipe carried in the legacy envelope. Live state ends
 * up exactly as a Preset load always left it: the composition applied, the
 * GUI-editable `presetBase` metadata seeded, and the transition recipe (if any)
 * resolved into `transitionState` for the Workspace to act on. An unresolved
 * transition ref leaves the transition inactive (the validator already rejects
 * such Presets, so this is defence in depth).
 *
 * `origin` is where the Scene came from: `{ slug, contentKey }` for a catalogue
 * Preset, with the content key its poster uses (`posterKeyForPreset`), or
 * `null` for a Scene that was not seeded from one.
 */
export function applyPreset(preset: Preset, origin: FilmSceneOrigin | null = null): void {
	applyFilm(filmFromPreset(preset, origin), legacyPresetEnvelopeFromPreset(preset));
}
