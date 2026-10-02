import type { OverlayPlacement } from './engine-schema';
import type { StagePlane, StageProjector } from './pipelines/depth-stage-planes';

/**
 * Editor-only geometry authority for direct canvas manipulation.
 *
 * Composition/render code must not import this module. It observes rendered DOM
 * bounds, projects them into the displayed canvas, and keeps three coordinate
 * spaces explicit:
 * - normalized/native composition coordinates are the only persistence space;
 * - screen coordinates are client CSS pixels used for pointer math;
 * - editor coordinates are CSS pixels local to CanvasEditingOverlay chrome.
 *
 * Rendered visible bounds, forgiving pointer bounds, selection order, and
 * handle chrome are separate values so a larger target can never alter pixels
 * or authored composition geometry.
 */

export interface CanvasInteractionPoint {
	x: number;
	y: number;
}

export interface CanvasInteractionRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface CanvasCompositionSize {
	width: number;
	height: number;
}

export interface CanvasCompositionCoordinate {
	normalized: CanvasInteractionPoint;
	native: CanvasInteractionPoint;
}

export interface CanvasCompositionBounds {
	normalized: CanvasInteractionRect;
	native: CanvasInteractionRect;
}

export interface CanvasRenderedBounds {
	/** Bounds observed in the authored composition before optional stage projection. */
	compositionBounds: CanvasCompositionBounds;
	/** Normalized rendered-frame bounds after optional stage projection. */
	frameBounds: CanvasInteractionRect;
	/** Client CSS pixels. Pointer events use this space. */
	screenBounds: CanvasInteractionRect;
	/** CSS pixels local to the CanvasEditingOverlay root. Editor chrome uses this space. */
	editorBounds: CanvasInteractionRect;
}

export interface CanvasInteractionGeometryViewport {
	editorBounds: CanvasInteractionRect;
	canvasBounds: CanvasInteractionRect;
	compositionDomBounds: CanvasInteractionRect;
	compositionSize: CanvasCompositionSize;
	projector: StageProjector | null;
}

export interface CanvasCompositionDelta {
	normalized: CanvasInteractionPoint;
	native: CanvasInteractionPoint;
}

export interface CanvasInteractionGeometryContract {
	renderedBoundsFor(
		sourceScreenBounds: CanvasInteractionRect,
		plane: StagePlane
	): CanvasRenderedBounds | null;
	/** The same bounds for a rect given directly in composition fractions. */
	renderedBoundsForComposition(
		normalized: CanvasInteractionRect,
		plane: StagePlane
	): CanvasRenderedBounds | null;
	screenPointToComposition(
		screenPoint: CanvasInteractionPoint,
		plane: StagePlane
	): CanvasCompositionCoordinate | null;
	compositionPointToScreen(
		normalizedPoint: CanvasInteractionPoint,
		plane: StagePlane
	): CanvasInteractionPoint | null;
	screenDeltaToComposition(
		startScreenPoint: CanvasInteractionPoint,
		endScreenPoint: CanvasInteractionPoint,
		plane: StagePlane
	): CanvasCompositionDelta | null;
}

function isFinitePoint(point: CanvasInteractionPoint): boolean {
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isFiniteRect(rect: CanvasInteractionRect): boolean {
	return (
		Number.isFinite(rect.left) &&
		Number.isFinite(rect.top) &&
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height) &&
		rect.width >= 0 &&
		rect.height >= 0
	);
}

function isUsableViewport(viewport: CanvasInteractionGeometryViewport): boolean {
	return (
		isFiniteRect(viewport.editorBounds) &&
		isFiniteRect(viewport.canvasBounds) &&
		isFiniteRect(viewport.compositionDomBounds) &&
		Number.isFinite(viewport.compositionSize.width) &&
		Number.isFinite(viewport.compositionSize.height) &&
		viewport.canvasBounds.width > 0 &&
		viewport.canvasBounds.height > 0 &&
		viewport.compositionDomBounds.width > 0 &&
		viewport.compositionDomBounds.height > 0 &&
		viewport.compositionSize.width > 0 &&
		viewport.compositionSize.height > 0
	);
}

function compositionRectFromScreenRect(
	screenRect: CanvasInteractionRect,
	compositionDomBounds: CanvasInteractionRect
): CanvasInteractionRect {
	return {
		left: (screenRect.left - compositionDomBounds.left) / compositionDomBounds.width,
		top: (screenRect.top - compositionDomBounds.top) / compositionDomBounds.height,
		width: screenRect.width / compositionDomBounds.width,
		height: screenRect.height / compositionDomBounds.height
	};
}

function nativeRectFromNormalizedRect(
	normalizedRect: CanvasInteractionRect,
	compositionSize: CanvasCompositionSize
): CanvasInteractionRect {
	return {
		left: normalizedRect.left * compositionSize.width,
		top: normalizedRect.top * compositionSize.height,
		width: normalizedRect.width * compositionSize.width,
		height: normalizedRect.height * compositionSize.height
	};
}

function projectCompositionRect(
	normalizedRect: CanvasInteractionRect,
	plane: StagePlane,
	projector: StageProjector | null
): CanvasInteractionRect | null {
	if (!projector) return { ...normalizedRect };
	const right = normalizedRect.left + normalizedRect.width;
	const bottom = normalizedRect.top + normalizedRect.height;
	const corners = [
		projector.projectPoint(plane, normalizedRect.left, normalizedRect.top),
		projector.projectPoint(plane, right, normalizedRect.top),
		projector.projectPoint(plane, normalizedRect.left, bottom),
		projector.projectPoint(plane, right, bottom)
	];
	if (!corners.every(isFinitePoint)) return null;
	const left = Math.min(...corners.map(({ x }) => x));
	const top = Math.min(...corners.map(({ y }) => y));
	const projectedRight = Math.max(...corners.map(({ x }) => x));
	const projectedBottom = Math.max(...corners.map(({ y }) => y));
	return { left, top, width: projectedRight - left, height: projectedBottom - top };
}

function screenRectFromFrameRect(
	frameRect: CanvasInteractionRect,
	canvasBounds: CanvasInteractionRect
): CanvasInteractionRect {
	return {
		left: canvasBounds.left + frameRect.left * canvasBounds.width,
		top: canvasBounds.top + frameRect.top * canvasBounds.height,
		width: frameRect.width * canvasBounds.width,
		height: frameRect.height * canvasBounds.height
	};
}

function editorRectFromScreenRect(
	screenRect: CanvasInteractionRect,
	editorBounds: CanvasInteractionRect
): CanvasInteractionRect {
	return {
		left: screenRect.left - editorBounds.left,
		top: screenRect.top - editorBounds.top,
		width: screenRect.width,
		height: screenRect.height
	};
}

/** Build the pure projection/conversion contract from current DOM measurements. */
export function createCanvasInteractionGeometryContract(
	viewport: CanvasInteractionGeometryViewport
): CanvasInteractionGeometryContract | null {
	if (!isUsableViewport(viewport)) return null;

	const normalizedToNativePoint = (
		normalizedPoint: CanvasInteractionPoint
	): CanvasInteractionPoint => ({
		x: normalizedPoint.x * viewport.compositionSize.width,
		y: normalizedPoint.y * viewport.compositionSize.height
	});

	const screenPointToComposition = (
		screenPoint: CanvasInteractionPoint,
		plane: StagePlane
	): CanvasCompositionCoordinate | null => {
		if (!isFinitePoint(screenPoint)) return null;
		const framePoint = {
			x: (screenPoint.x - viewport.canvasBounds.left) / viewport.canvasBounds.width,
			y: (screenPoint.y - viewport.canvasBounds.top) / viewport.canvasBounds.height
		};
		const normalized = viewport.projector
			? viewport.projector.raycastPoint(plane, framePoint.x, framePoint.y)
			: framePoint;
		if (!normalized || !isFinitePoint(normalized)) return null;
		return { normalized, native: normalizedToNativePoint(normalized) };
	};

	const renderedBoundsForComposition = (
		normalized: CanvasInteractionRect,
		plane: StagePlane
	): CanvasRenderedBounds | null => {
		if (!isFiniteRect(normalized)) return null;
		const frameBounds = projectCompositionRect(normalized, plane, viewport.projector);
		if (!frameBounds) return null;
		const screenBounds = screenRectFromFrameRect(frameBounds, viewport.canvasBounds);
		return {
			compositionBounds: {
				normalized,
				native: nativeRectFromNormalizedRect(normalized, viewport.compositionSize)
			},
			frameBounds,
			screenBounds,
			editorBounds: editorRectFromScreenRect(screenBounds, viewport.editorBounds)
		};
	};

	return {
		renderedBoundsFor(sourceScreenBounds, plane) {
			if (!isFiniteRect(sourceScreenBounds)) return null;
			return renderedBoundsForComposition(
				compositionRectFromScreenRect(sourceScreenBounds, viewport.compositionDomBounds),
				plane
			);
		},
		renderedBoundsForComposition,
		screenPointToComposition,
		compositionPointToScreen(normalizedPoint, plane) {
			if (!isFinitePoint(normalizedPoint)) return null;
			const framePoint = viewport.projector
				? viewport.projector.projectPoint(plane, normalizedPoint.x, normalizedPoint.y)
				: normalizedPoint;
			if (!isFinitePoint(framePoint)) return null;
			return {
				x: viewport.canvasBounds.left + framePoint.x * viewport.canvasBounds.width,
				y: viewport.canvasBounds.top + framePoint.y * viewport.canvasBounds.height
			};
		},
		screenDeltaToComposition(startScreenPoint, endScreenPoint, plane) {
			const start = screenPointToComposition(startScreenPoint, plane);
			const end = screenPointToComposition(endScreenPoint, plane);
			if (!start || !end) return null;
			return {
				normalized: {
					x: end.normalized.x - start.normalized.x,
					y: end.normalized.y - start.normalized.y
				},
				native: { x: end.native.x - start.native.x, y: end.native.y - start.native.y }
			};
		}
	};
}

export interface CanvasHitRegionOptions {
	paddingPx?: number;
	minimumPointerSizePx?: number;
	/** Optional editor-local clipping bounds, normally the displayed canvas. */
	clipBounds?: CanvasInteractionRect;
}

export interface CanvasHitRegionGeometry {
	visibleBounds: CanvasInteractionRect;
	pointerBounds: CanvasInteractionRect;
}

function intersectCanvasRects(
	first: CanvasInteractionRect,
	second: CanvasInteractionRect
): CanvasInteractionRect {
	const left = Math.max(first.left, second.left);
	const top = Math.max(first.top, second.top);
	const right = Math.min(first.left + first.width, second.left + second.width);
	const bottom = Math.min(first.top + first.height, second.top + second.height);
	return {
		left,
		top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top)
	};
}

/** Keep observed pixels separate from the editor-only pointer affordance. */
export function createCanvasHitRegionGeometry(
	visibleBounds: CanvasInteractionRect,
	options: CanvasHitRegionOptions = {}
): CanvasHitRegionGeometry {
	const paddingPx = Math.max(0, options.paddingPx ?? 0);
	const minimumPointerSizePx = Math.max(0, options.minimumPointerSizePx ?? 0);
	const pointerWidth = Math.max(visibleBounds.width + paddingPx * 2, minimumPointerSizePx);
	const pointerHeight = Math.max(visibleBounds.height + paddingPx * 2, minimumPointerSizePx);
	const expandedPointerBounds = {
		left: visibleBounds.left + (visibleBounds.width - pointerWidth) / 2,
		top: visibleBounds.top + (visibleBounds.height - pointerHeight) / 2,
		width: pointerWidth,
		height: pointerHeight
	};
	return {
		visibleBounds: { ...visibleBounds },
		pointerBounds: options.clipBounds
			? intersectCanvasRects(expandedPointerBounds, options.clipBounds)
			: expandedPointerBounds
	};
}

export type CanvasHandlePosition =
	'north-west' | 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west';

export type CanvasHandlePurpose = 'uniform-scale' | 'rotation' | 'inline-resize' | 'block-resize';

export interface CanvasHandleDescriptor {
	position: CanvasHandlePosition;
	purpose: CanvasHandlePurpose;
	outwardOffsetPx?: number;
	visualSizePx?: number;
	pointerSizePx?: number;
}

export interface CanvasHandleGeometry extends CanvasHandleDescriptor {
	center: CanvasInteractionPoint;
	visualBounds: CanvasInteractionRect;
	pointerBounds: CanvasInteractionRect;
	cursor: string;
}

const OVERLAY_SCALE_HANDLE_DESCRIPTORS: readonly CanvasHandleDescriptor[] = [
	{ position: 'north-west', purpose: 'uniform-scale' },
	{ position: 'north-east', purpose: 'uniform-scale' },
	{ position: 'south-west', purpose: 'uniform-scale' },
	{ position: 'south-east', purpose: 'uniform-scale' }
];

export const CANVAS_ROTATION_HANDLE_DESCRIPTOR: CanvasHandleDescriptor = {
	position: 'north',
	purpose: 'rotation',
	outwardOffsetPx: 18,
	visualSizePx: 9,
	pointerSizePx: 24
};

/** Side handles for text-container width changes without scaling typography. */
export const CANVAS_TEXT_INLINE_RESIZE_HANDLE_DESCRIPTORS = [
	{ position: 'west', purpose: 'inline-resize' },
	{ position: 'east', purpose: 'inline-resize' }
] as const satisfies readonly CanvasHandleDescriptor[];

/** The corner handle that resizes an authored frame (a chart's) without scaling its type. */
export const CANVAS_FRAME_RESIZE_HANDLE_DESCRIPTOR: CanvasHandleDescriptor = {
	position: 'south-east',
	purpose: 'block-resize'
};

function pinnedOverlayCorner(anchor: OverlayPlacement['anchor']): CanvasHandlePosition | undefined {
	const pinned: Partial<Record<OverlayPlacement['anchor'], CanvasHandlePosition>> = {
		'top-left': 'north-west',
		'top-right': 'north-east',
		'bottom-left': 'south-west',
		'bottom-right': 'south-east'
	};
	return pinned[anchor];
}

/** Uniform-scale handles excluding the fixed anchor corner. */
export function canvasOverlayScaleHandleDescriptors(
	anchor: OverlayPlacement['anchor']
): readonly CanvasHandleDescriptor[] {
	const pinned = pinnedOverlayCorner(anchor);
	return OVERLAY_SCALE_HANDLE_DESCRIPTORS.filter(({ position }) => position !== pinned);
}

function canvasHandleCenter(
	bounds: CanvasInteractionRect,
	position: CanvasHandlePosition,
	outwardOffsetPx: number
): CanvasInteractionPoint {
	const horizontal = position.endsWith('west')
		? bounds.left
		: position.endsWith('east')
			? bounds.left + bounds.width
			: bounds.left + bounds.width / 2;
	const vertical = position.startsWith('north')
		? bounds.top
		: position.startsWith('south')
			? bounds.top + bounds.height
			: bounds.top + bounds.height / 2;
	const offsetX =
		position === 'west' ? -outwardOffsetPx : position === 'east' ? outwardOffsetPx : 0;
	const offsetY =
		position === 'north' ? -outwardOffsetPx : position === 'south' ? outwardOffsetPx : 0;
	return { x: horizontal + offsetX, y: vertical + offsetY };
}

function centeredCanvasRect(center: CanvasInteractionPoint, size: number): CanvasInteractionRect {
	return {
		left: center.x - size / 2,
		top: center.y - size / 2,
		width: size,
		height: size
	};
}

function canvasHandleCursor(descriptor: CanvasHandleDescriptor): string {
	if (descriptor.purpose === 'rotation') return 'grab';
	if (descriptor.position === 'north-west' || descriptor.position === 'south-east') {
		return 'nwse-resize';
	}
	if (descriptor.position === 'north-east' || descriptor.position === 'south-west') {
		return 'nesw-resize';
	}
	if (descriptor.position === 'west' || descriptor.position === 'east') return 'ew-resize';
	return 'ns-resize';
}

/** Fixed-pixel editor handle geometry; never composition or export geometry. */
export function createCanvasHandleGeometry(
	visibleBounds: CanvasInteractionRect,
	descriptor: CanvasHandleDescriptor
): CanvasHandleGeometry {
	const center = canvasHandleCenter(
		visibleBounds,
		descriptor.position,
		Math.max(0, descriptor.outwardOffsetPx ?? 0)
	);
	const visualSizePx = Math.max(1, descriptor.visualSizePx ?? 10);
	const pointerSizePx = Math.max(visualSizePx, descriptor.pointerSizePx ?? 24);
	return {
		...descriptor,
		center,
		visualBounds: centeredCanvasRect(center, visualSizePx),
		pointerBounds: centeredCanvasRect(center, pointerSizePx),
		cursor: canvasHandleCursor(descriptor)
	};
}

// A stage body (ADR-0060 §3) ranks below everything the page carries: its
// projected box surrounds the glass, so a press on the picture reaches the
// page and a press on the housing reaches the body.
export type CanvasSelectionLayer =
	'stage-body' | 'surface-text' | 'surface-content' | 'block' | 'overlay';

export interface CanvasSelectionOrder {
	layer: CanvasSelectionLayer;
	paintIndex: number;
	stableId: string;
}

const CANVAS_SELECTION_LAYER_RANK: Record<CanvasSelectionLayer, number> = {
	'stage-body': 0,
	'surface-text': 1,
	'surface-content': 2,
	block: 3,
	overlay: 4
};

/** Topmost-first deterministic order for overlap hit resolution and cycling. */
export function compareCanvasSelectionOrder(
	first: CanvasSelectionOrder,
	second: CanvasSelectionOrder
): number {
	const layerDifference =
		CANVAS_SELECTION_LAYER_RANK[second.layer] - CANVAS_SELECTION_LAYER_RANK[first.layer];
	if (layerDifference !== 0) return layerDifference;
	const paintDifference = second.paintIndex - first.paintIndex;
	if (paintDifference !== 0) return paintDifference;
	if (first.stableId < second.stableId) return -1;
	if (first.stableId > second.stableId) return 1;
	return 0;
}

export function orderCanvasSelectionCandidates<
	Candidate extends { selectionOrder: CanvasSelectionOrder }
>(candidates: readonly Candidate[]): Candidate[] {
	return [...candidates].sort((first, second) =>
		compareCanvasSelectionOrder(first.selectionOrder, second.selectionOrder)
	);
}

export interface CanvasSelectionCandidate {
	selectionKey: string;
	selectionOrder: CanvasSelectionOrder;
	pointerBounds: CanvasInteractionRect;
}

function canvasRectContainsPoint(
	rect: CanvasInteractionRect,
	point: CanvasInteractionPoint
): boolean {
	return (
		point.x >= rect.left &&
		point.x < rect.left + rect.width &&
		point.y >= rect.top &&
		point.y < rect.top + rect.height
	);
}

/** Topmost-first candidates whose editor-only pointer bounds contain the screen point. */
export function canvasSelectionCandidatesAtPoint<Candidate extends CanvasSelectionCandidate>(
	candidates: readonly Candidate[],
	point: CanvasInteractionPoint
): Candidate[] {
	if (!isFinitePoint(point)) return [];
	return orderCanvasSelectionCandidates(
		candidates.filter(
			(candidate) =>
				isFiniteRect(candidate.pointerBounds) &&
				canvasRectContainsPoint(candidate.pointerBounds, point)
		)
	);
}

/**
 * Resolve a pointer press deterministically. A normal press keeps the current
 * canvas choice when it remains under the pointer, so a cycled lower candidate
 * can start a later drag. Otherwise it chooses the topmost candidate. An
 * Option/Alt press advances from the current choice without changing paint
 * order or persisted selection identity.
 */
export function resolveCanvasSelectionCandidateAtPoint<Candidate extends CanvasSelectionCandidate>(
	candidates: readonly Candidate[],
	point: CanvasInteractionPoint,
	options: { currentSelectionKey?: string | null; cycle?: boolean } = {}
): Candidate | null {
	const hits = canvasSelectionCandidatesAtPoint(candidates, point);
	if (hits.length === 0) return null;
	const selectedIndex = hits.findIndex(
		(candidate) => candidate.selectionKey === options.currentSelectionKey
	);
	if (selectedIndex < 0) return hits[0];
	return options.cycle ? hits[(selectedIndex + 1) % hits.length] : hits[selectedIndex];
}

/** CSS stack index matching the same layer and paint order used by hit resolution. */
export function canvasSelectionStackIndex(order: CanvasSelectionOrder): number {
	return CANVAS_SELECTION_LAYER_RANK[order.layer] * 100_000 + order.paintIndex;
}
