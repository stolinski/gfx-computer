/**
 * Timeline entity selection store (ADR-0034 §3).
 * Tracks selected Layer rows, Sound references, and Video clips in the timeline/canvas,
 * and the selected Scene boundary on the Scene strip.
 * null = composition root → inspector shows transport / Pack / Effects.
 * Runtime selection IDs are created and parsed by timeline-entity-identity.ts.
 */
import type { CanvasElementSelectionKey } from './canvas-element-selection';
import {
	createKeyframeSelectionId,
	createSoundRailReferenceId,
	createVideoClipSelectionId,
	type KeyframeSelectionId,
	type SoundRailReference,
	type TimelineEntitySelectionId,
	type TimelineTrackId
} from './timeline-entity-identity.ts';

export const layerSelection = $state<{ id: TimelineEntitySelectionId | null }>({ id: null });

/**
 * The Scene boundary selected on the Scene strip (ADR-0068 §10), as its index
 * into the open Film's `boundaries`: the boundary after Scene `boundaryIndex`.
 * A boundary belongs to the Film, not to a Timeline row, so it is selected with
 * no Layer selected and its fields show in the composition-root inspector.
 * Selecting anything else clears it.
 */
export const sceneBoundarySelection = $state<{ boundaryIndex: number | null }>({
	boundaryIndex: null
});

export function selectSceneBoundary(boundaryIndex: number): void {
	deselectLayer();
	sceneBoundarySelection.boundaryIndex = boundaryIndex;
}

/**
 * Spatial canvas multi-selection. `layerSelection` remains the primary entity
 * used by the timeline and Inspector; this ordered set adds compatible peers
 * for group alignment and distribution without changing persisted Preset data.
 */
export const canvasElementSelection = $state<{
	keys: CanvasElementSelectionKey[];
	primaryKey: CanvasElementSelectionKey | null;
}>({ keys: [], primaryKey: null });

export function setCanvasElementSelection(
	keys: readonly CanvasElementSelectionKey[],
	primaryKey: CanvasElementSelectionKey
): void {
	const uniqueKeys = keys.filter((key, index) => keys.indexOf(key) === index);
	if (!uniqueKeys.includes(primaryKey)) {
		throw new Error('Canvas multi-selection primary key must be selected.');
	}
	canvasElementSelection.keys = uniqueKeys;
	canvasElementSelection.primaryKey = primaryKey;
}

export function clearCanvasElementSelection(): void {
	canvasElementSelection.keys = [];
	canvasElementSelection.primaryKey = null;
}

/**
 * The selected keyframe diamond (ADR-0035 §7). Set by clicking/dragging a
 * diamond on the timeline; the timeline renders it active and the inspector's
 * keyframe rows reflect it.
 */
export const keyframeSelection = $state<{ id: KeyframeSelectionId | null }>({ id: null });

/**
 * On-canvas direct selection (epic 0pkzts2c): a one-shot "reveal this entity
 * in the inspector" request — e.g. `"slot:title"` from clicking a rendered
 * text slot. `seq` bumps on every request so repeat clicks on the same target
 * re-reveal (the target string alone wouldn't change). Consumed by the active
 * inspector via an effect (scroll + focus is a true DOM side effect).
 */
export const inspectorFocus = $state<{ target: string | null; seq: number }>({
	target: null,
	seq: 0
});

export function requestInspectorFocus(target: string): void {
	inspectorFocus.target = target;
	inspectorFocus.seq += 1;
}

export function selectKeyframe(trackId: TimelineTrackId, channel: string, index: number): void {
	clearCanvasElementSelection();
	keyframeSelection.id = createKeyframeSelectionId(trackId, channel, index);
}

export function clearKeyframeSelection(): void {
	keyframeSelection.id = null;
}

export function selectLayer(id: TimelineTrackId): void {
	clearCanvasElementSelection();
	sceneBoundarySelection.boundaryIndex = null;
	layerSelection.id = id;
	keyframeSelection.id = null;
	inspectorFocus.target = null;
}

export function selectSoundRailReference(reference: SoundRailReference): void {
	clearCanvasElementSelection();
	sceneBoundarySelection.boundaryIndex = null;
	layerSelection.id = createSoundRailReferenceId(reference);
	keyframeSelection.id = null;
	inspectorFocus.target = null;
}

export function selectVideoClip(clipId: string): void {
	clearCanvasElementSelection();
	sceneBoundarySelection.boundaryIndex = null;
	layerSelection.id = createVideoClipSelectionId(clipId);
	keyframeSelection.id = null;
	inspectorFocus.target = null;
}

export function deselectLayer(): void {
	clearCanvasElementSelection();
	sceneBoundarySelection.boundaryIndex = null;
	layerSelection.id = null;
	keyframeSelection.id = null;
	inspectorFocus.target = null;
}
