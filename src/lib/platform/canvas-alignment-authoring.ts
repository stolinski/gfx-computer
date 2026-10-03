import type { VideoOrientation } from '$lib/utils/video-frame';
import {
	cloneDiagramPrimitiveGeometry,
	resolveDiagramPrimitiveGeometry,
	type DiagramPrimitiveGeometry
} from '$lib/utils/diagram-geometry';
import {
	cloneKineticWordGeometry,
	resolveKineticWordGeometry
} from '$lib/utils/kinetic-word-geometry';
import { clampNumber } from '$lib/utils/math';
import { cloneOverlayPlacement, resolveOverlayPlacement } from '$lib/utils/overlay-placement';

import type { CanvasAlignableElement, CanvasElementTranslation } from './canvas-alignment';
import { parseCanvasElementSelectionKey } from './canvas-element-selection';
import type {
	DiagramLabelGeometry,
	DiagramPrimitive,
	DiagramPositionGeometry,
	DiagramTimelineGeometry,
	EngineState,
	KineticWord,
	KineticWordGeometry,
	Overlay,
	OverlayPlacement
} from './engine-schema';

export type CanvasAlignmentAuthoringState = Pick<EngineState, 'overlays' | 'surface' | 'transport'>;

type CanvasAlignmentGeometrySource = 'base' | 'orientation-override';

export type CanvasAlignmentGeometrySnapshot =
	| {
			kind: 'overlay';
			id: string;
			orientation: VideoOrientation;
			source: CanvasAlignmentGeometrySource;
			geometry: OverlayPlacement;
	  }
	| {
			kind: 'block';
			id: string;
			orientation: VideoOrientation;
			source: CanvasAlignmentGeometrySource;
			geometry: DiagramPrimitiveGeometry;
	  }
	| {
			kind: 'kinetic-word';
			id: string;
			orientation: VideoOrientation;
			source: CanvasAlignmentGeometrySource;
			geometry: KineticWordGeometry;
	  };

export interface CanvasAlignmentGeometryChange {
	before: readonly CanvasAlignmentGeometrySnapshot[];
	after: readonly CanvasAlignmentGeometrySnapshot[];
}

const CANVAS_AUTHORING_PRECISION = 1_000_000;

function roundCanvasAuthoringValue(value: number): number {
	const rounded = Math.round(value * CANVAS_AUTHORING_PRECISION) / CANVAS_AUTHORING_PRECISION;
	return Object.is(rounded, -0) ? 0 : rounded;
}

function boundedCanvasAuthoringValue(value: number): number {
	return roundCanvasAuthoringValue(clampNumber(value, 0, 1));
}

function overlayGeometrySource(
	overlay: Overlay,
	orientation: VideoOrientation
): CanvasAlignmentGeometrySource {
	return overlay.position.orientationOverrides?.[orientation] ? 'orientation-override' : 'base';
}

function blockGeometrySource(
	primitive: DiagramPrimitive,
	orientation: VideoOrientation
): CanvasAlignmentGeometrySource {
	return primitive.orientationOverrides?.[orientation] ? 'orientation-override' : 'base';
}

function cloneResolvedDiagramGeometry(
	primitive: DiagramPrimitive,
	orientation: VideoOrientation
): DiagramPrimitiveGeometry | null {
	switch (primitive.type) {
		case 'node':
		case 'label':
		case 'stat-callout':
			return cloneDiagramPrimitiveGeometry(resolveDiagramPrimitiveGeometry(primitive, orientation));
		case 'timeline-segment':
			return cloneDiagramPrimitiveGeometry(resolveDiagramPrimitiveGeometry(primitive, orientation));
		case 'edge-arrow':
			return null;
	}
}

function captureCanvasAlignmentGeometry(
	state: CanvasAlignmentAuthoringState,
	selectionKey: CanvasElementTranslation['selectionKey'],
	orientation: VideoOrientation
): CanvasAlignmentGeometrySnapshot | null {
	const identity = parseCanvasElementSelectionKey(selectionKey);
	if (!identity) return null;
	if (identity.kind === 'overlay') {
		const overlay = state.overlays.find(({ id }) => id === identity.id);
		if (!overlay) return null;
		return {
			kind: 'overlay',
			id: overlay.id,
			orientation,
			source: overlayGeometrySource(overlay, orientation),
			geometry: cloneOverlayPlacement(resolveOverlayPlacement(overlay.position, orientation))
		};
	}
	const word = findKineticWord(state, identity.id);
	if (word) {
		return {
			kind: 'kinetic-word',
			id: word.id,
			orientation,
			source: word.orientationOverrides?.[orientation] ? 'orientation-override' : 'base',
			geometry: cloneKineticWordGeometry(resolveKineticWordGeometry(word, orientation))
		};
	}
	const primitive = state.surface.diagram?.find(({ id }) => id === identity.id);
	if (!primitive) return null;
	const geometry = cloneResolvedDiagramGeometry(primitive, orientation);
	if (!geometry) return null;
	return {
		kind: 'block',
		id: primitive.id,
		orientation,
		source: blockGeometrySource(primitive, orientation),
		geometry
	};
}

// Kinetic Words share the Block selection namespace with Diagram primitives
// (ADR-0064); alignment moves a word's resting position in the active
// orientation, keeping its anchor, scale, and rotation.
function findKineticWord(state: CanvasAlignmentAuthoringState, id: string): KineticWord | null {
	return state.surface.typeField?.words.find((word) => word.id === id) ?? null;
}

function copyKineticWordGeometry(
	word: KineticWord,
	snapshot: Extract<CanvasAlignmentGeometrySnapshot, { kind: 'kinetic-word' }>
): boolean {
	const target =
		snapshot.source === 'base' ? word : (word.orientationOverrides?.[snapshot.orientation] ?? null);
	if (!target) return false;
	target.position = { ...snapshot.geometry.position };
	target.horizontalAnchor = snapshot.geometry.horizontalAnchor;
	target.scale = snapshot.geometry.scale;
	target.rotation = snapshot.geometry.rotation;
	return true;
}

function copyOverlayPlacement(target: OverlayPlacement, source: OverlayPlacement): void {
	target.anchor = source.anchor;
	target.offset = source.offset ? { ...source.offset } : undefined;
	target.rect = source.rect ? { ...source.rect } : undefined;
	target.scale = source.scale;
	target.rotation = source.rotation;
}

function overlaySnapshotTarget(
	overlay: Overlay,
	snapshot: Extract<CanvasAlignmentGeometrySnapshot, { kind: 'overlay' }>
): OverlayPlacement | null {
	if (snapshot.source === 'base') return overlay.position;
	return overlay.position.orientationOverrides?.[snapshot.orientation] ?? null;
}

function isDiagramPositionGeometry(
	geometry: DiagramPrimitiveGeometry
): geometry is DiagramPositionGeometry | DiagramLabelGeometry {
	return 'position' in geometry;
}

function isDiagramTimelineGeometry(
	geometry: DiagramPrimitiveGeometry
): geometry is DiagramTimelineGeometry {
	return !('position' in geometry) && !('route' in geometry);
}

function copyDiagramGeometry(
	primitive: DiagramPrimitive,
	geometry: DiagramPrimitiveGeometry,
	orientation: VideoOrientation,
	source: CanvasAlignmentGeometrySource
): boolean {
	switch (primitive.type) {
		case 'node':
		case 'stat-callout': {
			const resolved =
				source === 'base' ? primitive : (primitive.orientationOverrides?.[orientation] ?? null);
			if (!resolved || !isDiagramPositionGeometry(geometry)) return false;
			resolved.position.x = geometry.position.x;
			resolved.position.y = geometry.position.y;
			resolved.scale = geometry.scale;
			return true;
		}
		case 'label': {
			const resolved =
				source === 'base' ? primitive : (primitive.orientationOverrides?.[orientation] ?? null);
			if (!resolved || !isDiagramPositionGeometry(geometry)) return false;
			resolved.position.x = geometry.position.x;
			resolved.position.y = geometry.position.y;
			resolved.scale = geometry.scale;
			resolved.maxWidth = 'maxWidth' in geometry ? geometry.maxWidth : undefined;
			return true;
		}
		case 'timeline-segment': {
			const resolved =
				source === 'base' ? primitive : (primitive.orientationOverrides?.[orientation] ?? null);
			if (!resolved || !isDiagramTimelineGeometry(geometry)) return false;
			resolved.from.x = geometry.from.x;
			resolved.from.y = geometry.from.y;
			resolved.to.x = geometry.to.x;
			resolved.to.y = geometry.to.y;
			return true;
		}
		case 'edge-arrow':
			return false;
	}
}

/** Restore only authored placement geometry, leaving content and timing untouched. */
export function restoreCanvasAlignmentGeometry(
	state: CanvasAlignmentAuthoringState,
	snapshots: readonly CanvasAlignmentGeometrySnapshot[]
): boolean {
	let restoredAll = true;
	for (const snapshot of snapshots) {
		if (snapshot.kind === 'overlay') {
			const overlay = state.overlays.find(({ id }) => id === snapshot.id);
			const target = overlay ? overlaySnapshotTarget(overlay, snapshot) : null;
			if (!target) {
				restoredAll = false;
				continue;
			}
			copyOverlayPlacement(target, snapshot.geometry);
			continue;
		}
		if (snapshot.kind === 'kinetic-word') {
			const word = findKineticWord(state, snapshot.id);
			if (!word || !copyKineticWordGeometry(word, snapshot)) restoredAll = false;
			continue;
		}
		const primitive = state.surface.diagram?.find(({ id }) => id === snapshot.id);
		if (
			!primitive ||
			!copyDiagramGeometry(primitive, snapshot.geometry, snapshot.orientation, snapshot.source)
		) {
			restoredAll = false;
		}
	}
	return restoredAll;
}

function translateOverlay(
	overlay: Overlay,
	bounds: CanvasAlignableElement['bounds'],
	translation: CanvasElementTranslation,
	orientation: VideoOrientation
): void {
	const placement = resolveOverlayPlacement(overlay.position, orientation);
	const { x: deltaX, y: deltaY } = translation.delta;
	const xCentered =
		placement.anchor === 'center' ||
		placement.anchor === 'top-center' ||
		placement.anchor === 'bottom-center';
	const yCentered = placement.anchor === 'center';
	const requiresFreePlacement = (xCentered && deltaX !== 0) || (yCentered && deltaY !== 0);

	if (requiresFreePlacement) {
		placement.anchor = 'top-left';
		placement.offset = {
			x: boundedCanvasAuthoringValue(bounds.left + deltaX),
			y: boundedCanvasAuthoringValue(bounds.top + deltaY)
		};
		placement.rect = undefined;
		return;
	}

	if (placement.anchor === 'normalized-rect') {
		if (!placement.rect) return;
		placement.rect.x = roundCanvasAuthoringValue(placement.rect.x + deltaX);
		placement.rect.y = roundCanvasAuthoringValue(placement.rect.y + deltaY);
		return;
	}

	if (!placement.offset) placement.offset = { x: 0, y: 0 };
	const horizontalSign = placement.anchor.endsWith('right') ? -1 : 1;
	const verticalSign = placement.anchor.startsWith('bottom') ? -1 : 1;
	placement.offset.x = boundedCanvasAuthoringValue(placement.offset.x + horizontalSign * deltaX);
	placement.offset.y = boundedCanvasAuthoringValue(placement.offset.y + verticalSign * deltaY);
}

function translateDiagramPrimitive(
	primitive: DiagramPrimitive,
	translation: CanvasElementTranslation,
	orientation: VideoOrientation
): void {
	const { x: deltaX, y: deltaY } = translation.delta;
	switch (primitive.type) {
		case 'node':
		case 'label':
		case 'stat-callout': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			geometry.position.x = boundedCanvasAuthoringValue(geometry.position.x + deltaX);
			geometry.position.y = boundedCanvasAuthoringValue(geometry.position.y + deltaY);
			return;
		}
		case 'timeline-segment': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			geometry.from.x = boundedCanvasAuthoringValue(geometry.from.x + deltaX);
			geometry.from.y = boundedCanvasAuthoringValue(geometry.from.y + deltaY);
			geometry.to.x = boundedCanvasAuthoringValue(geometry.to.x + deltaX);
			geometry.to.y = boundedCanvasAuthoringValue(geometry.to.y + deltaY);
			return;
		}
		case 'edge-arrow':
			return;
	}
}

interface PreparedCanvasAlignmentMutation {
	element: CanvasAlignableElement;
	translation: CanvasElementTranslation;
	before: CanvasAlignmentGeometrySnapshot;
}

/**
 * Apply one already-resolved command atomically to the active orientation.
 * Returns exact before/after geometry for edit-history undo and redo.
 */
export function applyCanvasAlignmentTranslations(
	state: CanvasAlignmentAuthoringState,
	elements: readonly CanvasAlignableElement[],
	translations: readonly CanvasElementTranslation[]
): CanvasAlignmentGeometryChange | null {
	if (translations.length === 0) return null;
	const orientation = state.transport.orientation;
	const elementsByKey = new Map(elements.map((element) => [element.selectionKey, element]));
	const prepared: PreparedCanvasAlignmentMutation[] = [];

	for (const translation of translations) {
		if (
			!Number.isFinite(translation.delta.x) ||
			!Number.isFinite(translation.delta.y) ||
			(translation.delta.x === 0 && translation.delta.y === 0)
		) {
			return null;
		}
		const element = elementsByKey.get(translation.selectionKey);
		const before = captureCanvasAlignmentGeometry(state, translation.selectionKey, orientation);
		if (!element || !before) return null;
		const identity = parseCanvasElementSelectionKey(translation.selectionKey);
		if (!identity) return null;
		if (identity.kind === 'overlay') {
			const overlay = state.overlays.find(({ id }) => id === identity.id);
			const placement = overlay ? resolveOverlayPlacement(overlay.position, orientation) : null;
			if (!overlay || !placement || (placement.anchor === 'normalized-rect' && !placement.rect)) {
				return null;
			}
		}
		prepared.push({ element, translation, before });
	}

	for (const { element, translation } of prepared) {
		const identity = parseCanvasElementSelectionKey(translation.selectionKey);
		if (!identity) return null;
		if (identity.kind === 'overlay') {
			const overlay = state.overlays.find(({ id }) => id === identity.id);
			if (overlay) translateOverlay(overlay, element.bounds, translation, orientation);
			continue;
		}
		const word = findKineticWord(state, identity.id);
		if (word) {
			const geometry = resolveKineticWordGeometry(word, orientation);
			geometry.position.x = boundedCanvasAuthoringValue(geometry.position.x + translation.delta.x);
			geometry.position.y = boundedCanvasAuthoringValue(geometry.position.y + translation.delta.y);
			continue;
		}
		const primitive = state.surface.diagram?.find(({ id }) => id === identity.id);
		if (primitive) translateDiagramPrimitive(primitive, translation, orientation);
	}

	const after = prepared.map(({ translation }) =>
		captureCanvasAlignmentGeometry(state, translation.selectionKey, orientation)
	);
	if (after.some((snapshot) => snapshot === null)) {
		restoreCanvasAlignmentGeometry(
			state,
			prepared.map(({ before }) => before)
		);
		return null;
	}

	return {
		before: prepared.map(({ before }) => before),
		after: after.filter(
			(snapshot): snapshot is CanvasAlignmentGeometrySnapshot => snapshot !== null
		)
	};
}
