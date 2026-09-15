/**
 * Which WebMCP tools can succeed right now
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §5).
 *
 * A tool is registered only in a state where calling it would work:
 * `gfx_layer_remove_overlay` does not exist until an Overlay does, and
 * `gfx_composition_undo` does not exist with an empty history. An impossible
 * verb is absent rather than present-and-refusing, which is what stops an agent
 * from planning a route through a tool it cannot run.
 *
 * The answer is one boolean per declared precondition, so the type system —
 * not a reviewer — is what notices a precondition nobody answered. The read
 * splits in two because the browser answers most of it synchronously from live
 * composition state while the session catalog is an async store read: the
 * synchronous half runs inside the caller's reactive scope so an edit re-runs
 * it, and the catalog half is awaited beside it.
 */
import { compositionEditHistory } from './composition-edit-history';
import { compositionMediaGrants } from './composition-media-grants.svelte';
import { compositionMeta } from './composition-meta.svelte';
import { getSurfaceDefinition } from './pipelines/definition-registry';
import {
	readOpenCompositionDocument,
	readOpenCompositionSlug
} from './composition-operation-preflight';
import { transitionState } from './engine-state.svelte';
import { parseCompositionSessionStoreConfig } from './public-runtime-contract';
import { userCompositionStore } from './user-composition-store';
import { userPackStore } from './user-pack-store';

import { KINETIC_TYPE_WORD_LIMIT, type EngineState, type Preset } from './engine-schema';
import { env } from '$env/dynamic/public';

import type { WebmcpOperationPrecondition } from './webmcp-operation-inventory';

/** The preconditions only a store can answer: the browser session catalog and the origin's User Pack store. */
export type WebmcpStorePreconditionName =
	'session-composition-present' | 'user-pack-store-served' | 'user-pack-present';

/** Every precondition the open composition answers without touching a store. */
export type WebmcpCompositionPreconditionName = Exclude<
	WebmcpOperationPrecondition,
	WebmcpStorePreconditionName
>;

export type WebmcpCompositionPreconditions = Readonly<
	Record<WebmcpCompositionPreconditionName, boolean>
>;

/** The complete registration state a controller decides its tool set from. */
export type WebmcpRegistrationState = Readonly<Record<WebmcpOperationPrecondition, boolean>>;

/** Whether any Overlay pins a placement for one delivery orientation. */
function hasOrientationOverride(state: EngineState): boolean {
	return state.overlays.some((overlay) => {
		const overrides = overlay.position.orientationOverrides;
		return (
			overrides !== undefined &&
			(overrides.horizontal !== undefined || overrides.vertical !== undefined)
		);
	});
}

/** Whether any element carries authored keyframes rather than its intrinsic motion. */
function hasKeyframeChannel(state: EngineState): boolean {
	const carriers = [
		state.surface.animation,
		...state.overlays.map((overlay) => overlay.animation),
		...(state.surface.diagram ?? []).map((primitive) => primitive.animation)
	];
	return carriers.some((motion) => Object.keys(motion?.channels ?? {}).length > 0);
}

/** Whether any of the four anchorable entities is welded to another one. */
function hasCascadeAnchor(state: EngineState): boolean {
	return (
		state.overlays.some((overlay) => overlay.animation?.cascade !== undefined) ||
		state.marks.timings.some((timing) => timing.cascade !== undefined) ||
		state.textAnimations.some((entry) => entry.cascade !== undefined) ||
		(state.surface.diagram ?? []).some((primitive) => primitive.animation?.cascade !== undefined)
	);
}

/**
 * What a closed page can answer. Every decision except reading the session
 * catalog needs an open composition, so a cold page offers exactly the short
 * menu ADR-0054 §5 asks for rather than a wall of impossible verbs.
 */
function closedCompositionPreconditions(): WebmcpCompositionPreconditions {
	return {
		always: true,
		'composition-open': false,
		'composition-editable': false,
		'forked-from-starter': false,
		'undo-available': false,
		'redo-available': false,
		'overlay-present': false,
		'effect-present': false,
		'mark-present': false,
		'text-animation-present': false,
		'diagram-present': false,
		'kinetic-word-addable': false,
		'kinetic-word-present': false,
		'chart-present': false,
		'captions-present': false,
		'chat-surface-active': false,
		'checklist-surface-active': false,
		'orientation-override-present': false,
		'keyframe-channel-present': false,
		'cascade-anchor-present': false,
		'transition-present': false,
		'audio-cue-present': false,
		'media-permitted': false,
		'media-entry-present': false,
		'video-clip-present': false
	};
}

/**
 * The open composition's answers. Reads the whole document rather than a
 * handful of fields on purpose: the caller runs this inside a reactive scope,
 * and a narrow read would leave a tool registered after the edit that made it
 * impossible.
 */
export function readWebmcpCompositionPreconditions(): WebmcpCompositionPreconditions {
	if (readOpenCompositionSlug() === null) return closedCompositionPreconditions();

	const document: Preset = readOpenCompositionDocument();
	const state = document.state;
	const editable = !transitionState.capturing;
	const surface = getSurfaceDefinition(state.surface.type);

	return {
		always: true,
		'composition-open': true,
		'composition-editable': editable,
		'forked-from-starter': compositionMeta.forkedFrom !== null,
		'undo-available': editable && compositionEditHistory.canUndo,
		'redo-available': editable && compositionEditHistory.canRedo,
		'overlay-present': editable && state.overlays.length > 0,
		'effect-present': editable && state.effects.length > 0,
		'mark-present': editable && state.marks.timings.length > 0,
		'text-animation-present': editable && state.textAnimations.length > 0,
		'diagram-present': editable && (state.surface.diagram ?? []).length > 0,
		'kinetic-word-addable':
			editable &&
			state.surface.type === 'plain' &&
			state.stage === undefined &&
			(state.surface.typeField?.words.length ?? 0) < KINETIC_TYPE_WORD_LIMIT,
		'kinetic-word-present': editable && (state.surface.typeField?.words ?? []).length > 0,
		'chart-present': editable && (state.surface.chart?.items ?? []).length > 0,
		'captions-present': editable && state.captions !== undefined,
		'chat-surface-active': editable && surface?.controls.messages === true,
		'checklist-surface-active': editable && surface?.controls.items === true,
		'orientation-override-present': editable && hasOrientationOverride(state),
		'keyframe-channel-present': editable && hasKeyframeChannel(state),
		'cascade-anchor-present': editable && hasCascadeAnchor(state),
		'transition-present': editable && document.transition !== undefined,
		'audio-cue-present': editable && state.audioCues.length > 0,
		'media-permitted': editable && compositionMediaGrants.hasGrant,
		'media-entry-present': editable && state.media.assets.length > 0,
		'video-clip-present': editable && state.media.videoTrack.clips.length > 0
	};
}

/**
 * Whether this browser session holds a composition to delete or clear. An
 * unreachable store answers no: a tool that cannot reach its storage should be
 * absent rather than register and fail with `storage_unavailable`.
 */
export async function readWebmcpSessionCompositionPresence(): Promise<boolean> {
	try {
		return (await userCompositionStore.listUserCompositions()).length > 0;
	} catch (error) {
		console.error('WebMCP registration could not read the session composition catalog', error);
		return false;
	}
}

/** What the origin's User Pack store can say about itself (ADR-0055). */
export interface WebmcpUserPackPreconditions {
	/** This build serves the disk-backed store at all; a browser-scoped session never does. */
	served: boolean;
	/** The store holds at least one pack to save or delete. */
	present: boolean;
}

/**
 * Whether this build serves the User Pack store, and whether it holds a pack.
 * A browser-scoped session has no pack store, so its tools are absent rather
 * than present-and-refusing; an unreachable store answers no for the same
 * reason the session catalog does.
 */
export async function readWebmcpUserPackPreconditions(): Promise<WebmcpUserPackPreconditions> {
	if (parseCompositionSessionStoreConfig(env).kind !== 'origin') {
		return { served: false, present: false };
	}
	try {
		return { served: true, present: (await userPackStore.listUserPacks()).length > 0 };
	} catch (error) {
		console.error('WebMCP registration could not read the User Pack store', error);
		return { served: false, present: false };
	}
}

export function completeWebmcpRegistrationState(
	composition: WebmcpCompositionPreconditions,
	sessionCompositionPresent: boolean,
	userPacks: WebmcpUserPackPreconditions = { served: false, present: false }
): WebmcpRegistrationState {
	// Pack authoring dresses an open composition, so a cold page keeps its short menu.
	const open = composition['composition-open'];
	return {
		...composition,
		'session-composition-present': sessionCompositionPresent,
		'user-pack-store-served': open && userPacks.served,
		'user-pack-present': open && userPacks.present
	};
}
