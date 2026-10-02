/**
 * The `placement` family: where an element sits in the frame, at each
 * orientation
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2).
 *
 * Every deliverable composition reflows between horizontal and vertical, so
 * placement is authored twice over: a shared placement that both orientations
 * fall back to, and a complete per-orientation snapshot that replaces it. The
 * snapshot is replaced whole rather than merged — an anchor from one
 * orientation and an offset from the other is exactly the ambiguity that makes
 * reflow unpredictable — which is why writing one orientation takes a complete
 * placement and why clearing one is its own operation.
 *
 * A stat callout's `from` and `to` are the counted range rather than a
 * position, but they live at `/state/surface/diagram/<id>/from` and `/to`, which
 * this family owns. So this operation writes them, and `content` refuses them
 * and points here. Pointer ownership decides, not the field's name.
 */
import { cloneOverlayPlacement } from '../utils/overlay-placement';
import { compositionEditHistory } from './composition-edit-history';
import {
	CompositionOperationError,
	runCompositionEditTransaction,
	type CompositionOperationOutcome
} from './composition-edit-transaction';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseUnlessCompositionEditable,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';
import { COMPOSITION_ORIENTATIONS } from './composition-transport-operations';

import {
	ChartFrameRectSchema,
	ChecklistCardPlacementSchema,
	STAGE_CAMERA_POSE_LIMITS
} from './engine-schema';
import { describeCompositionSchemaFindings } from './composition-validation-findings';
import type {
	ChartFrameRect,
	ChecklistCardPlacement,
	DiagramEndpoint,
	DiagramPoint,
	DiagramPrimitive,
	Overlay,
	OverlayPlacement,
	OverlayPose,
	Transport
} from './engine-schema';
import { getSurfaceDefinition } from './pipelines/definition-registry';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

/** Which placement a write lands on: the shared one, or one orientation's snapshot. */
export type CompositionPlacementTarget = 'shared' | Transport['orientation'];

/**
 * The placements a write can land on, built from the delivery orientations so a
 * reflow target this engine gains is a target this family accepts.
 */
export const COMPOSITION_PLACEMENT_TARGETS: readonly CompositionPlacementTarget[] = [
	'shared',
	...COMPOSITION_ORIENTATIONS
];

export interface SetCompositionOverlayPlacementRequest {
	expectedRevision: number;
	overlayId: string;
	/** `shared` writes the fallback both orientations use; an orientation writes its snapshot. */
	target: CompositionPlacementTarget;
	/** The complete placement — anchor, offset, rect, scale, static rotation. */
	placement: OverlayPlacement;
}

export interface ClearCompositionOrientationOverrideRequest {
	expectedRevision: number;
	overlayId: string;
	orientation: Transport['orientation'];
}

export interface SetCompositionOverlayDepthRequest {
	expectedRevision: number;
	overlayId: string;
	/** 0 the Surface plane, 1 the backdrop, negative lifted toward the camera. `null` returns the Layer default. */
	z: number | null;
}

export interface SetCompositionOverlayPoseRequest {
	expectedRevision: number;
	overlayId: string;
	/** Degrees about the Overlay's rendered centre; omitted angles hold 0. `null` removes the pose. */
	pose: { yaw?: number; pitch?: number; roll?: number } | null;
}

export interface SetCompositionSurfacePageAnchorRequest {
	expectedRevision: number;
	/**
	 * The page point (capture fractions) at frame centre in the filmed framing.
	 * `null` removes it: the shared point returns to the page centre, and an
	 * orientation point returns that orientation to the shared one.
	 */
	pageAnchor: { x: number; y: number } | null;
	/** The shared point both orientations fall back to, or one orientation's own. Absent is shared. */
	target?: CompositionPlacementTarget;
}

export interface SetCompositionChecklistCardRequest {
	expectedRevision: number;
	/** The shared placement both orientations fall back to, or one orientation's own. */
	target: CompositionPlacementTarget;
	/**
	 * The card's left edge, vertical centre, and width in frame fractions.
	 * `null` removes it: the shared placement returns to the pipeline layout,
	 * and an orientation placement returns that orientation to the shared one.
	 */
	card: ChecklistCardPlacement | null;
}

export interface SetCompositionChartFrameRequest {
	expectedRevision: number;
	blockId: string;
	/** The shared frame both orientations fall back to, or one orientation's own. */
	target: CompositionPlacementTarget;
	/**
	 * The normalized frame rect the chart lays itself out inside. `null` removes
	 * it: the shared frame returns to the automatic title-safe layout, and an
	 * orientation frame returns that orientation to the shared one.
	 */
	frame: ChartFrameRect | null;
}

/** The geometry fields a diagram primitive carries, in composition fractions. */
export interface DiagramGeometryPatch {
	position?: DiagramPoint;
	/**
	 * An edge or timeline-segment endpoint — a node reference or an explicit
	 * point — or a stat callout's counted range, which sits at the same pointer
	 * and so belongs to this family too.
	 */
	from?: DiagramEndpoint | number;
	to?: DiagramEndpoint | number;
	control?: DiagramPoint;
	scale?: number;
	maxWidth?: number;
}

export interface SetCompositionDiagramGeometryRequest {
	expectedRevision: number;
	blockId: string;
	/** `shared` writes the primitive's own geometry; an orientation writes its override. */
	target: CompositionPlacementTarget;
	geometry: DiagramGeometryPatch;
}

type DiagramGeometryField = keyof DiagramGeometryPatch;

/** The geometry fields each primitive type carries on itself. */
const DIAGRAM_GEOMETRY_FIELDS: Record<DiagramPrimitive['type'], readonly DiagramGeometryField[]> = {
	node: ['position', 'scale'],
	label: ['position', 'scale', 'maxWidth'],
	'stat-callout': ['position', 'scale', 'from', 'to'],
	'edge-arrow': ['from', 'to', 'control'],
	'timeline-segment': ['from', 'to']
};

/**
 * The fields an orientation snapshot holds. Narrower than the shared set on the
 * stat callout, whose snapshot is position and scale: its `from`/`to` are the
 * counted range, which does not reflow and so has no per-orientation value.
 */
const DIAGRAM_ORIENTATION_GEOMETRY_FIELDS: Record<
	DiagramPrimitive['type'],
	readonly DiagramGeometryField[]
> = {
	node: ['position', 'scale'],
	label: ['position', 'scale', 'maxWidth'],
	'stat-callout': ['position', 'scale'],
	'edge-arrow': ['from', 'to', 'control'],
	'timeline-segment': ['from', 'to']
};

function refuseUnknownOverlay(
	row: WebmcpOperationRow,
	overlayId: string,
	overlays: readonly Overlay[]
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'unknown_target',
		`No Overlay in this composition is named "${overlayId}".`,
		{ rejected: overlayId, alternatives: overlays.map((overlay) => overlay.id) }
	);
}

function refuseUnknownPlacementTarget(
	row: WebmcpOperationRow,
	target: string
): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'invalid_argument',
		`"${target}" is not a placement target; write the shared placement or one orientation.`,
		{ rejected: target, alternatives: COMPOSITION_PLACEMENT_TARGETS }
	);
}

function isPlacementTarget(value: string): value is CompositionPlacementTarget {
	return COMPOSITION_PLACEMENT_TARGETS.some((target) => target === value);
}

// ---- Overlay placement ----

/**
 * Set one Overlay's placement — either the shared placement, or one complete
 * orientation snapshot.
 */
export async function runSetCompositionOverlayPlacementOperation(
	request: SetCompositionOverlayPlacementRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-overlay-placement');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const overlays = readOpenCompositionDocument().state.overlays;
	if (!overlays.some((overlay) => overlay.id === request.overlayId)) {
		return refuseUnknownOverlay(row, request.overlayId, overlays);
	}
	if (!isPlacementTarget(request.target)) {
		return refuseUnknownPlacementTarget(row, request.target);
	}

	const placement = cloneOverlayPlacement(request.placement);

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel:
			request.target === 'shared'
				? 'Set Overlay placement'
				: `Set ${request.target} Overlay placement`,
		focus: { target: 'overlay', overlayId: request.overlayId },
		mutate: (draft) => {
			const overlay = requireDraftOverlay(draft.state.overlays, request.overlayId);
			if (request.target === 'shared') {
				overlay.position = {
					...placement,
					orientationOverrides: overlay.position.orientationOverrides
				};
				return;
			}
			overlay.position.orientationOverrides = {
				...overlay.position.orientationOverrides,
				[request.target]: placement
			};
		}
	});
}

/** Drop one orientation's snapshot so that orientation falls back to the shared placement. */
export async function runClearCompositionOrientationOverrideOperation(
	request: ClearCompositionOrientationOverrideRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.clear-orientation-override');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const overlays = readOpenCompositionDocument().state.overlays;
	const overlay = overlays.find((entry) => entry.id === request.overlayId);
	if (!overlay) {
		return refuseUnknownOverlay(row, request.overlayId, overlays);
	}
	if (!COMPOSITION_ORIENTATIONS.includes(request.orientation)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			`"${request.orientation}" is not a delivery orientation.`,
			{ rejected: request.orientation, alternatives: COMPOSITION_ORIENTATIONS }
		);
	}
	if (!overlay.position.orientationOverrides?.[request.orientation]) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`Overlay "${overlay.id}" already takes the shared placement at ${request.orientation}.`,
			{ rejected: request.orientation }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: `Clear ${request.orientation} placement`,
		focus: { target: 'overlay', overlayId: request.overlayId },
		mutate: (draft) => {
			const target = requireDraftOverlay(draft.state.overlays, request.overlayId);
			const overrides = { ...target.position.orientationOverrides };
			delete overrides[request.orientation];
			target.position.orientationOverrides =
				overrides.horizontal || overrides.vertical ? overrides : undefined;
		}
	});
}

/** Set one Overlay's focal distance. Inert without a depth-of-field Effect or a stage. */
export async function runSetCompositionOverlayDepthOperation(
	request: SetCompositionOverlayDepthRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-overlay-depth');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const overlays = readOpenCompositionDocument().state.overlays;
	if (!overlays.some((overlay) => overlay.id === request.overlayId)) {
		return refuseUnknownOverlay(row, request.overlayId, overlays);
	}
	if (request.z !== null && !(Number.isFinite(request.z) && request.z >= -1 && request.z <= 1)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'Depth runs from -1 (lifted toward the camera) through 0 at the Surface plane to 1 at the backdrop; on the depth stage an explicit depth gives the Overlay its own plane.',
			{ rejected: String(request.z), alternatives: ['-0.2', '0', '0.7', 'null'] }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: 'Set Overlay depth',
		focus: { target: 'overlay', overlayId: request.overlayId },
		mutate: (draft) => {
			requireDraftOverlay(draft.state.overlays, request.overlayId).z = request.z ?? undefined;
		}
	});
}

/** Turn one Overlay's own plane on the depth stage (ADR-0057); with an explicit depth it is what lifts the Overlay onto that plane. */
export async function runSetCompositionOverlayPoseOperation(
	request: SetCompositionOverlayPoseRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-overlay-pose');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const overlays = readOpenCompositionDocument().state.overlays;
	if (!overlays.some((overlay) => overlay.id === request.overlayId)) {
		return refuseUnknownOverlay(row, request.overlayId, overlays);
	}
	let pose: OverlayPose | undefined;
	if (request.pose !== null) {
		const angles = [
			['yaw', request.pose.yaw ?? 0, STAGE_CAMERA_POSE_LIMITS.yawDegrees],
			['pitch', request.pose.pitch ?? 0, STAGE_CAMERA_POSE_LIMITS.pitchDegrees],
			['roll', request.pose.roll ?? 0, STAGE_CAMERA_POSE_LIMITS.rollDegrees]
		] as const;
		for (const [axis, value, limit] of angles) {
			if (!(Number.isFinite(value) && Math.abs(value) <= limit)) {
				return refuseCompositionOperation(
					row,
					compositionEditHistory.revision,
					'invalid_argument',
					`${axis} runs from -${limit} to ${limit} degrees.`,
					{ rejected: String(value), alternatives: [`-${limit}`, '0', `${limit}`] }
				);
			}
		}
		pose = {
			yaw: request.pose.yaw ?? 0,
			pitch: request.pose.pitch ?? 0,
			roll: request.pose.roll ?? 0
		};
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: pose ? 'Pose Overlay' : 'Clear Overlay pose',
		focus: { target: 'overlay', overlayId: request.overlayId },
		mutate: (draft) => {
			requireDraftOverlay(draft.state.overlays, request.overlayId).pose = pose;
		}
	});
}

/** Choose which page point the filmed website-screenshot framing puts at frame centre (ADR-0057). */
export async function runSetCompositionSurfacePageAnchorOperation(
	request: SetCompositionSurfacePageAnchorRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-surface-page-anchor');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const surface = readOpenCompositionDocument().state.surface;
	if (!getSurfaceDefinition(surface.type)?.controls.websiteCapture) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`The ${surface.type} Surface has no page to anchor; the page anchor belongs to the website-screenshot Surface in its filmed framing.`,
			{ rejected: surface.type, alternatives: ['website-screenshot'] }
		);
	}
	const target = request.target ?? 'shared';
	if (!isPlacementTarget(target)) return refuseUnknownPlacementTarget(row, target);
	const anchor = request.pageAnchor;
	if (
		anchor !== null &&
		!(
			Number.isFinite(anchor.x) &&
			Number.isFinite(anchor.y) &&
			anchor.x >= 0 &&
			anchor.x <= 1 &&
			anchor.y >= 0 &&
			anchor.y <= 1
		)
	) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'invalid_argument',
			'The page anchor is a point in capture fractions, 0 through 1 on each axis.',
			{ rejected: JSON.stringify(anchor), alternatives: ['{"x":0.5,"y":0.5}', 'null'] }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: target === 'shared' ? 'Set page anchor' : `Set ${target} page anchor`,
		focus: { target: 'surface' },
		mutate: (draft) => {
			const surface = draft.state.surface;
			const point = anchor === null ? undefined : { x: anchor.x, y: anchor.y };
			if (target === 'shared') {
				surface.pageAnchor = point;
				return;
			}
			const overrides = { ...surface.pageAnchorOrientationOverrides, [target]: point };
			if (point === undefined) delete overrides[target];
			surface.pageAnchorOrientationOverrides =
				overrides.horizontal || overrides.vertical ? overrides : undefined;
		}
	});
}

// ---- Checklist card ----

/** Place the checklist card, shared or per orientation (ADR-0039 §4). */
export async function runSetCompositionChecklistCardOperation(
	request: SetCompositionChecklistCardRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-checklist-card');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const surface = readOpenCompositionDocument().state.surface;
	if (surface.type !== 'checklist') {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'precondition_unmet',
			`The ${surface.type} Surface has no checklist card to place.`,
			{ rejected: surface.type, alternatives: ['checklist'] }
		);
	}
	if (!isPlacementTarget(request.target)) return refuseUnknownPlacementTarget(row, request.target);
	let card: ChecklistCardPlacement | undefined;
	if (request.card !== null) {
		const parsed = ChecklistCardPlacementSchema.safeParse(request.card);
		if (!parsed.success) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'invalid_argument',
				'A checklist card placement is a left edge, vertical centre, and width in frame fractions; the width is at least 0.15 and the card fits the frame width.',
				{ findings: describeCompositionSchemaFindings(parsed.error) }
			);
		}
		card = parsed.data;
	}
	const target = request.target;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: target === 'shared' ? 'Place checklist card' : `Place ${target} checklist card`,
		focus: { target: 'surface' },
		mutate: (draft) => {
			const draftSurface = draft.state.surface;
			if (target === 'shared') {
				draftSurface.checklistCard = card;
				return;
			}
			const overrides = { ...draftSurface.checklistCardOrientationOverrides, [target]: card };
			if (!card) delete overrides[target];
			draftSurface.checklistCardOrientationOverrides =
				overrides.horizontal || overrides.vertical ? overrides : undefined;
		}
	});
}

// ---- Chart frame ----

/**
 * Place and size one chart Block's frame (ADR-0048 amendment, ADR-0039 §4):
 * shared, or one orientation's complete frame. Typography stays chart-owned.
 */
export async function runSetCompositionChartFrameOperation(
	request: SetCompositionChartFrameRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-chart-frame');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const items = readOpenCompositionDocument().state.surface.chart?.items ?? [];
	if (!items.some((item) => item.id === request.blockId)) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'unknown_target',
			`This composition holds no chart Block "${request.blockId}".`,
			{ rejected: request.blockId, alternatives: items.map((item) => item.id) }
		);
	}
	if (!isPlacementTarget(request.target)) return refuseUnknownPlacementTarget(row, request.target);
	let frame: ChartFrameRect | undefined;
	if (request.frame !== null) {
		const parsed = ChartFrameRectSchema.safeParse(request.frame);
		if (!parsed.success) {
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'invalid_argument',
				'A chart frame is a normalized rect that fits inside the frame, at least a tenth of it on each side.',
				{ findings: describeCompositionSchemaFindings(parsed.error) }
			);
		}
		frame = parsed.data;
	}
	const target = request.target;

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel: target === 'shared' ? 'Set chart frame' : `Set ${target} chart frame`,
		focus: { target: 'block', blockId: request.blockId },
		mutate: (draft) => {
			const item = draft.state.surface.chart?.items.find((entry) => entry.id === request.blockId);
			if (!item) {
				throw new CompositionOperationError(
					'unknown_target',
					`Chart Block "${request.blockId}" is no longer in the composition.`,
					{ rejected: request.blockId }
				);
			}
			if (target === 'shared') {
				if (frame) item.frame = frame;
				else delete item.frame;
				return;
			}
			const overrides = { ...item.frameOrientationOverrides, [target]: frame };
			if (!frame) delete overrides[target];
			if (overrides.horizontal || overrides.vertical) item.frameOrientationOverrides = overrides;
			else delete item.frameOrientationOverrides;
		}
	});
}

// ---- Diagram geometry ----

/**
 * Set one diagram primitive's composition-space geometry, either shared or for
 * one orientation. An orientation override is a complete geometry snapshot, so
 * the fields the caller leaves out are taken from the geometry that orientation
 * currently resolves to rather than left undefined.
 */
export async function runSetCompositionDiagramGeometryOperation(
	request: SetCompositionDiagramGeometryRequest
): Promise<CompositionOperationOutcome> {
	const row = requireCompositionOperationRow('placement.set-diagram-geometry');
	const refusal = refuseUnlessCompositionEditable(row);
	if (refusal) return refusal;

	const revision = compositionEditHistory.revision;
	const diagram = readOpenCompositionDocument().state.surface.diagram ?? [];
	const primitive = diagram.find((entry) => entry.id === request.blockId);
	if (!primitive) {
		return refuseCompositionOperation(
			row,
			revision,
			'unknown_target',
			`No diagram Block in this composition is named "${request.blockId}".`,
			{ rejected: request.blockId, alternatives: diagram.map((entry) => entry.id) }
		);
	}
	if (!isPlacementTarget(request.target)) {
		return refuseUnknownPlacementTarget(row, request.target);
	}

	const accepted =
		request.target === 'shared'
			? DIAGRAM_GEOMETRY_FIELDS[primitive.type]
			: DIAGRAM_ORIENTATION_GEOMETRY_FIELDS[primitive.type];
	for (const field of Object.keys(request.geometry)) {
		if (!accepted.includes(field as DiagramGeometryField)) {
			return refuseCompositionOperation(
				row,
				revision,
				'invalid_argument',
				request.target === 'shared'
					? `A ${primitive.type} Block has no "${field}" geometry.`
					: `A ${primitive.type} Block's ${request.target} snapshot holds no "${field}".`,
				{ rejected: field, alternatives: accepted }
			);
		}
	}
	if (Object.keys(request.geometry).length === 0) {
		return refuseCompositionOperation(
			row,
			revision,
			'invalid_argument',
			`Name at least one geometry field to write on a ${primitive.type} Block.`,
			{ alternatives: accepted }
		);
	}

	return runCompositionEditTransaction({
		operationId: row.id,
		expectedRevision: request.expectedRevision,
		undoLabel:
			request.target === 'shared' ? 'Set Block geometry' : `Set ${request.target} Block geometry`,
		focus: { target: 'block', blockId: request.blockId },
		mutate: (draft) => {
			const entries = draft.state.surface.diagram ?? [];
			const index = entries.findIndex((entry) => entry.id === request.blockId);
			if (index < 0) {
				throw new CompositionOperationError(
					'unknown_target',
					`Block "${request.blockId}" is no longer on the Surface.`,
					{ rejected: request.blockId }
				);
			}
			const current = entries[index];
			if (request.target === 'shared') {
				entries[index] = { ...current, ...request.geometry } as DiagramPrimitive;
				return;
			}
			const resolved: Record<string, unknown> = {
				...(current as unknown as Record<string, unknown>),
				...((current.orientationOverrides?.[request.target] ?? {}) as Record<string, unknown>)
			};
			const snapshot: Record<string, unknown> = Object.fromEntries(
				accepted.map((field) => [
					field,
					field in request.geometry ? request.geometry[field] : resolved[field]
				])
			);
			// `route` completes an edge's geometry snapshot but is authored content,
			// so it is carried from the geometry this orientation already resolves
			// to rather than written here.
			if (current.type === 'edge-arrow') snapshot.route = resolved.route;
			entries[index] = {
				...current,
				orientationOverrides: {
					...current.orientationOverrides,
					[request.target]: snapshot
				}
			} as DiagramPrimitive;
		}
	});
}

function requireDraftOverlay(overlays: Overlay[], overlayId: string): Overlay {
	const overlay = overlays.find((entry) => entry.id === overlayId);
	if (!overlay) {
		throw new CompositionOperationError(
			'unknown_target',
			`Overlay "${overlayId}" is no longer in the composition.`,
			{ rejected: overlayId }
		);
	}
	return overlay;
}
