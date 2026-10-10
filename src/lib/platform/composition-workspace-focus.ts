/**
 * Where the Workspace focus lands after an authoring operation
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §4).
 *
 * Every mutating operation moves the visible focus to the entity it touched.
 * That is not decoration: it is how a person watching the screen sees what an
 * agent just did, which is why the inventory requires a focus target on every
 * `write` row and why the transaction core refuses a focus that disagrees with
 * the row.
 *
 * Two of the inventory's focus targets name no Workspace entity and are
 * deliberately absent from this union. `timeline-playhead` belongs to
 * `playhead.seek-frame`, which moves the playhead itself rather than a
 * selection, and `session-catalog` names the home route's composition list,
 * which is not part of the Workspace at all.
 */
import { inspectorRailMode } from './inspector-rail-mode.svelte';
import {
	deselectLayer,
	requestInspectorFocus,
	selectLayer,
	selectSceneBoundary,
	selectSoundRailReference,
	selectVideoClip
} from './selection.svelte';
import { createTimelineTrackId, type SoundRailReference } from './timeline-entity-identity';
import type { WebmcpOperationFocusTarget } from './webmcp-operation-inventory';

export type CompositionWorkspaceFocus =
	| { target: 'composition-root' }
	| { target: 'scene-boundary'; boundaryIndex: number }
	| { target: 'surface' }
	| { target: 'overlay'; overlayId: string }
	| { target: 'block'; blockId: string }
	| { target: 'mark'; markIndex: number }
	| { target: 'text-animation'; textAnimationId: string }
	| { target: 'effect'; effectId: string }
	| { target: 'sound-cue'; reference: SoundRailReference }
	| { target: 'captions' }
	| { target: 'media-library' }
	| { target: 'video-clip'; clipId: string }
	| { target: 'stage-camera' }
	| { target: 'stage-focus' }
	| { target: 'stage-body'; bodyId: string };

/**
 * The focus targets a Workspace-resident operation may name. Declared as data
 * so the transaction core can reject an unsupported target and so the inventory
 * test can prove every `write` and `history` row lands on one of them.
 */
export const COMPOSITION_WORKSPACE_FOCUS_TARGETS = [
	'composition-root',
	'scene-boundary',
	'surface',
	'overlay',
	'block',
	'mark',
	'text-animation',
	'effect',
	'sound-cue',
	'captions',
	'media-library',
	'video-clip',
	'stage-camera',
	'stage-focus',
	'stage-body'
] as const satisfies readonly WebmcpOperationFocusTarget[];

function unhandledWorkspaceFocus(focus: never): never {
	throw new TypeError(`Composition workspace focus is not handled: ${JSON.stringify(focus)}`);
}

/**
 * Reveal the entity an operation touched. The rail mode moves with the focus,
 * because a Media library entry selected behind the Inspector rail is not
 * visible and therefore not focused.
 */
export function moveCompositionWorkspaceFocus(focus: CompositionWorkspaceFocus): void {
	if (focus.target === 'media-library') {
		inspectorRailMode.switchToMedia();
		deselectLayer();
		return;
	}

	inspectorRailMode.switchToInspector();

	switch (focus.target) {
		case 'composition-root':
			deselectLayer();
			return;
		case 'scene-boundary':
			// The junction on the Scene strip; its fields show in the root inspector.
			selectSceneBoundary(focus.boundaryIndex);
			return;
		case 'surface':
			selectLayer(createTimelineTrackId({ kind: 'surface' }));
			return;
		case 'overlay':
			selectLayer(createTimelineTrackId({ kind: 'overlay', overlayId: focus.overlayId }));
			return;
		case 'block':
			selectLayer(createTimelineTrackId({ kind: 'block', blockId: focus.blockId }));
			return;
		case 'mark':
			selectLayer(createTimelineTrackId({ kind: 'mark', index: focus.markIndex }));
			return;
		case 'text-animation':
			selectLayer(
				createTimelineTrackId({
					kind: 'text-animation',
					textAnimationId: focus.textAnimationId
				})
			);
			return;
		case 'effect':
			// The Effect chain is a composition-root section, so the Effect is
			// revealed by returning to the root inspector and naming the row.
			deselectLayer();
			requestInspectorFocus(`effect:${focus.effectId}`);
			return;
		case 'sound-cue':
			selectSoundRailReference(focus.reference);
			return;
		case 'captions':
			selectLayer(createTimelineTrackId({ kind: 'captions' }));
			return;
		case 'video-clip':
			selectVideoClip(focus.clipId);
			return;
		case 'stage-camera':
			selectLayer(createTimelineTrackId({ kind: 'stage-camera' }));
			return;
		case 'stage-focus':
			selectLayer(createTimelineTrackId({ kind: 'stage-focus' }));
			return;
		case 'stage-body':
			selectLayer(createTimelineTrackId({ kind: 'stage-body', bodyId: focus.bodyId }));
			return;
		default:
			unhandledWorkspaceFocus(focus);
	}
}
