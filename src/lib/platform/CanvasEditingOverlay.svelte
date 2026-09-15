<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	import { animState } from './anim-state.svelte';
	import CanvasAlignmentToolbar from './CanvasAlignmentToolbar.svelte';
	import {
		resolveCanvasAlignmentTranslations,
		resolveCanvasDistributionTranslations,
		type CanvasAlignableElement,
		type CanvasAlignmentCommand,
		type CanvasAlignmentReference,
		type CanvasDistributionCommand,
		type CanvasElementTranslation
	} from './canvas-alignment';
	import {
		applyCanvasAlignmentTranslations,
		restoreCanvasAlignmentGeometry,
		type CanvasAlignmentGeometryChange,
		type CanvasAlignmentGeometrySnapshot
	} from './canvas-alignment-authoring';
	import {
		isCanvasSnapBypassGesture,
		resolveCanvasDragSnapping,
		type CanvasSnapGuide
	} from './canvas-drag-snapping';
	import {
		CANVAS_ROTATION_HANDLE_DESCRIPTOR,
		CANVAS_TEXT_INLINE_RESIZE_HANDLE_DESCRIPTORS,
		canvasOverlayScaleHandleDescriptors,
		canvasSelectionStackIndex,
		createCanvasHandleGeometry,
		createCanvasHitRegionGeometry,
		createCanvasInteractionGeometryContract,
		resolveCanvasSelectionCandidateAtPoint,
		type CanvasHitRegionGeometry,
		type CanvasRenderedBounds,
		type CanvasInteractionGeometryContract,
		type CanvasInteractionPoint,
		type CanvasInteractionRect,
		type CanvasSelectionCandidate,
		type CanvasSelectionLayer
	} from './canvas-interaction-geometry';
	import {
		isCanvasElementSelectionKey,
		parseCanvasElementSelectionKey,
		type CanvasElementSelectionKey
	} from './canvas-element-selection';
	import { compositionEditHistory } from './composition-edit-history';
	import {
		runSetCompositionKineticWordPlacementOperation,
		runSetCompositionKineticWordPositionKeyframeOperation
	} from './composition-kinetic-type-operations';
	import {
		captureCompositionGestureOrigin,
		recordCompositionGestureEdit
	} from './composition-edit-transaction';
	import {
		captureDiagramLabelTextBoxSnapshot,
		diagramLabelTextBoxSnapshotsEqual,
		resolveDiagramLabelTextBoxResize,
		restoreDiagramLabelTextBoxSnapshot,
		type CanvasTextBoxResizeSide,
		type DiagramLabelTextBoxSnapshot
	} from './canvas-text-box-resize';
	import { engineState, packState } from './engine-state.svelte';
	import { getPack } from './packs/registry';
	import {
		createStageCameraRig,
		resolveStageCameraForOrientation
	} from './pipelines/depth-stage-camera';
	import {
		projectStageBodyFrameBounds,
		projectStageMeshFrameBounds,
		resolveStageScreenGlass
	} from './pipelines/depth-stage-geometry';
	import { resolveOverlayStageBodies } from './stage-body-overlays';
	import type { StageTypefaceData } from './stage-glyph-format';
	import type { StageMeshData } from './stage-mesh-format';
	import {
		createStageProjector,
		isPosedStageOverlay,
		posedOverlayStagePlane,
		type StagePlane
	} from './pipelines/depth-stage-planes';
	import {
		restStageCameraPose,
		setStageCameraPoseAngle,
		setStageCameraPoseDistance,
		stageDollyDistance,
		stageOrbitDegreesForDrag
	} from './stage-camera-editing';
	import { STAGE_CAMERA_POSE_LIMITS, type Preset, type StageCameraPose } from './engine-schema';
	import { getStageModel } from './stage-models';
	import {
		canvasElementSelection,
		layerSelection,
		selectLayer,
		deselectLayer,
		requestInspectorFocus,
		setCanvasElementSelection
	} from './selection.svelte';
	import { timelineHandle } from './timeline-handle.svelte';
	import {
		createTimelineTrackId,
		STAGE_SCREEN_BODY_ID,
		type TimelineTrackIdentity
	} from './timeline-entity-identity';
	import { resolveDiagramPrimitiveGeometry } from '$lib/utils/diagram-geometry';
	import {
		cloneKineticWordGeometry,
		resolveKineticWordGeometry
	} from '$lib/utils/kinetic-word-geometry';
	import { clampNumber } from '$lib/utils/math';
	import { resolveOverlayPlacement } from '$lib/utils/overlay-placement';
	import type {
		ChatMessage,
		ChecklistItem,
		DiagramLabel,
		DiagramPrimitive,
		KineticWord,
		KineticWordGeometry,
		Overlay,
		OverlayPlacement
	} from './engine-schema';

	interface Props {
		compositionElement: HTMLElement | null;
		/** The hoisted Overlay-root sibling while the plane split is on (DOF /
		 *  depth stage / owned surface opacity) — overlays live there, not in
		 *  `compositionElement`. Null on the flat path (overlays inline). */
		overlayRootElement?: HTMLElement | null;
		/** The posed Overlays' own roots on the depth stage (ADR-0057), by Overlay id. */
		posedOverlayRootElements?: Record<string, HTMLElement | null>;
		/** The resident screen body's mesh (ADR-0060 §3); null until the model lands or when there is none. */
		stageBodyMesh?: StageMeshData | null;
		/** The decoded typefaces the stage's body Overlays set in (ADR-0062), null until ready. */
		stageTypeface?: (slug: string) => StageTypefaceData | null;
		canvas: HTMLCanvasElement | null;
		compositionSize: { width: number; height: number };
		/** Display zoom; pan is only active when zoomed in (> 1). */
		zoom?: number;
		panX?: number;
		panY?: number;
		onPan?: (x: number, y: number) => void;
		onPanStart?: () => void;
		onPanEnd?: () => void;
	}

	let {
		compositionElement,
		overlayRootElement = null,
		posedOverlayRootElements = {},
		stageBodyMesh = null,
		stageTypeface = () => null,
		canvas,
		compositionSize,
		zoom = 1,
		panX = 0,
		panY = 0,
		onPan,
		onPanStart,
		onPanEnd
	}: Props = $props();

	let rootEl = $state<HTMLDivElement | null>(null);
	let lastCanvasSelectionKey = $state<string | null>(null);

	function isTrackSelected(identity: TimelineTrackIdentity): boolean {
		return layerSelection.id === createTimelineTrackId(identity);
	}

	function canvasElementTrackIdentity(
		selectionKey: CanvasElementSelectionKey
	): TimelineTrackIdentity {
		const identity = parseCanvasElementSelectionKey(selectionKey);
		if (!identity) throw new Error(`Invalid spatial canvas selection key: ${selectionKey}`);
		return identity.kind === 'overlay'
			? { kind: 'overlay', overlayId: identity.id }
			: { kind: 'block', blockId: identity.id };
	}

	function isCanvasElementSelected(
		selectionKey: CanvasElementSelectionKey,
		identity: TimelineTrackIdentity
	): boolean {
		return (
			canvasElementSelection.keys.includes(selectionKey) ||
			(canvasElementSelection.keys.length === 0 && isTrackSelected(identity))
		);
	}

	function isPrimaryCanvasElement(
		selectionKey: CanvasElementSelectionKey,
		identity: TimelineTrackIdentity
	): boolean {
		return (
			canvasElementSelection.primaryKey === selectionKey ||
			(canvasElementSelection.primaryKey === null && isTrackSelected(identity))
		);
	}

	function selectSpatialCanvasElement(
		selectionKey: CanvasElementSelectionKey,
		mode: 'replace' | 'preserve' | 'toggle'
	): void {
		const currentKeys = [...canvasElementSelection.keys];
		const alreadySelected = currentKeys.includes(selectionKey);
		let nextKeys: CanvasElementSelectionKey[];
		let primaryKey: CanvasElementSelectionKey | null;

		if (mode === 'toggle') {
			nextKeys = alreadySelected
				? currentKeys.filter((key) => key !== selectionKey)
				: [...currentKeys, selectionKey];
			primaryKey = alreadySelected
				? canvasElementSelection.primaryKey === selectionKey
					? (nextKeys.at(-1) ?? null)
					: canvasElementSelection.primaryKey
				: selectionKey;
		} else {
			nextKeys = mode === 'preserve' && alreadySelected ? currentKeys : [selectionKey];
			primaryKey = selectionKey;
		}

		if (!primaryKey || nextKeys.length === 0) {
			deselectLayer();
			return;
		}
		selectLayer(createTimelineTrackId(canvasElementTrackIdentity(primaryKey)));
		setCanvasElementSelection(nextKeys, primaryKey);
	}

	function isCanvasCandidateSelected(
		selectionKey: string,
		identity: TimelineTrackIdentity
	): boolean {
		return lastCanvasSelectionKey === selectionKey && isTrackSelected(identity);
	}

	// ─── Coordinate helpers ──────────────────────────────────────────────────────

	function getOverlayEl(overlay: Overlay): HTMLElement | null {
		const selector = `[data-overlay-id="${overlay.id}"]`;
		return (
			posedOverlayRootElements[overlay.id]?.querySelector<HTMLElement>(selector) ??
			overlayRootElement?.querySelector<HTMLElement>(selector) ??
			compositionElement?.querySelector<HTMLElement>(selector) ??
			null
		);
	}

	// Which captured plane an Overlay's pixels ride: its own posed plane on the
	// depth stage (ADR-0057) or the shared Overlay plane.
	function overlayPlane(overlay: Overlay): StagePlane {
		return engineState.stage?.type === 'depth' && isPosedStageOverlay(overlay)
			? posedOverlayStagePlane(overlay.id)
			: 'overlay';
	}

	function overlayPlaneById(overlayId: string): StagePlane {
		const overlay = engineState.overlays.find((candidate) => candidate.id === overlayId);
		return overlay ? overlayPlane(overlay) : 'overlay';
	}

	// A posed Overlay turns about its rendered centre; measure it against its
	// own frame-sized root so the editor's plane matches the renderer's.
	function measureOverlayPivot(overlay: Overlay): { x: number; y: number } {
		const root = posedOverlayRootElements[overlay.id] ?? overlayRootElement ?? compositionElement;
		const el = getOverlayEl(overlay);
		if (!root || !el) return { x: 0.5, y: 0.5 };
		const rootRect = root.getBoundingClientRect();
		const rect = el.getBoundingClientRect();
		if (rootRect.width <= 0 || rootRect.height <= 0) return { x: 0.5, y: 0.5 };
		return {
			x: (rect.left - rootRect.left + rect.width / 2) / rootRect.width,
			y: (rect.top - rootRect.top + rect.height / 2) / rootRect.height
		};
	}

	// Depth-stage projection (m182h9gp): when the composition declares a depth
	// stage, the rendered pixels are the captured planes reprojected through the
	// stage's perspective camera — a flat DOM box no longer lands where its
	// pixels are. The projector rebuilds the renderer's exact camera (shared
	// math in depth-stage-camera.ts) from the same state resolveStage feeds it,
	// so hit boxes project forward and pointer drags ray-cast back onto the
	// element's plane. Surface content rides the surface plane; overlays ride
	// the hoisted overlay plane at their ADR-0021 z. Reading globalProgress
	// keeps every projected box tracking the camera move with the playhead.
	const stageProjector = $derived.by(() => {
		const stage = engineState.stage;
		if (!stage || stage.type !== 'depth') return null;
		if (compositionSize.width === 0 || compositionSize.height === 0) return null;
		// Posed Overlays turn about their measured centres, so re-measure with
		// the same epoch the boxes use.
		void measureEpoch;
		const aspect = compositionSize.width / compositionSize.height;
		// A screen's glass is the Surface plane (ADR-0051 phase 2): the same
		// opening and crop the renderer builds, so page hit-tests land on the tube.
		const screenModel = stage.screen ? getStageModel(stage.screen.model) : null;
		const screenGlass = screenModel
			? resolveStageScreenGlass(aspect, screenModel.screen)
			: undefined;
		return createStageProjector({
			aspect,
			camera: resolveStageCameraForOrientation(stage.camera, engineState.transport.orientation),
			overlayZ: 0.7,
			screenGlass,
			posedOverlayPlanes: engineState.overlays.filter(isPosedStageOverlay).map((overlay) => ({
				overlayId: overlay.id,
				z: overlay.z ?? 0.7,
				pose: overlay.pose,
				pivot: measureOverlayPivot(overlay)
			})),
			time: clampNumber(animState.globalProgress, 0, 1)
		});
	});

	function canvasInteractionRect(rect: DOMRect): CanvasInteractionRect {
		return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
	}

	// Read current browser measurements at the gesture/paint boundary. CSS zoom
	// and pan are already reflected by the canvas rect; the shared contract keeps
	// those screen pixels separate from normalized/native persistence geometry.
	function currentCanvasInteractionGeometry(): CanvasInteractionGeometryContract | null {
		const editorRect = rootEl?.getBoundingClientRect();
		const canvasRect = canvas?.getBoundingClientRect();
		const compositionRect = compositionElement?.getBoundingClientRect();
		if (!editorRect || !canvasRect || !compositionRect) return null;
		return createCanvasInteractionGeometryContract({
			editorBounds: canvasInteractionRect(editorRect),
			canvasBounds: canvasInteractionRect(canvasRect),
			compositionDomBounds: canvasInteractionRect(compositionRect),
			compositionSize,
			projector: stageProjector
		});
	}

	function projectRect(
		el: HTMLElement,
		plane: StagePlane = 'surface'
	): CanvasInteractionRect | null {
		void measureEpoch;
		return (
			currentCanvasInteractionGeometry()?.renderedBoundsFor(
				canvasInteractionRect(el.getBoundingClientRect()),
				plane
			)?.editorBounds ?? null
		);
	}

	const CANVAS_SELECTION_PADDING_PX = 4;
	const CANVAS_SELECTION_MINIMUM_SIZE_PX = 24;
	const CANVAS_OVERLAP_CYCLE_HINT = 'Alt/Option-click to cycle overlapping elements';
	const CANVAS_SELECTION_MODIFIER_HINT =
		'Shift-click or Shift-Enter to add or remove selection · Arrow keys to nudge · Alt/Option-click to cycle overlaps · Cmd/Ctrl-drag to bypass snapping';

	function currentVisibleCanvasEditorBounds(): CanvasInteractionRect | null {
		const editorRect = rootEl?.getBoundingClientRect();
		const canvasRect = canvas?.getBoundingClientRect();
		if (!editorRect || !canvasRect) return null;
		const left = Math.max(0, canvasRect.left - editorRect.left);
		const top = Math.max(0, canvasRect.top - editorRect.top);
		const right = Math.min(editorRect.width, canvasRect.right - editorRect.left);
		const bottom = Math.min(editorRect.height, canvasRect.bottom - editorRect.top);
		if (right <= left || bottom <= top) return null;
		return { left, top, width: right - left, height: bottom - top };
	}

	function canvasHitRegion(rect: CanvasInteractionRect): CanvasHitRegionGeometry | null {
		if (rect.width <= 0 && rect.height <= 0) return null;
		const clipBounds = currentVisibleCanvasEditorBounds();
		if (!clipBounds) return null;
		const region = createCanvasHitRegionGeometry(rect, {
			paddingPx: CANVAS_SELECTION_PADDING_PX,
			minimumPointerSizePx: CANVAS_SELECTION_MINIMUM_SIZE_PX,
			clipBounds
		});
		return region.pointerBounds.width > 0 && region.pointerBounds.height > 0 ? region : null;
	}

	// ─── The stage body on the canvas (ADR-0060 §3) ─────────────────────────────
	// The screen body is a mesh, not a DOM box: its selection region is the
	// projected bounding box of its resident mesh, placed as the renderer
	// places it and projected through the renderer's own camera, so the box
	// tracks the camera move with the playhead like every other region.

	function selectStageBody(bodyId: string): void {
		selectLayer(createTimelineTrackId({ kind: 'stage-body', bodyId }));
	}

	function stageBodyHitRegion(): CanvasHitRegionGeometry | null {
		const stage = engineState.stage;
		if (!stage || stage.type !== 'depth' || !stage.screen || !stageBodyMesh) return null;
		const model = getStageModel(stage.screen.model);
		if (!model || compositionSize.width === 0 || compositionSize.height === 0) return null;
		void measureEpoch;
		const editorRect = rootEl?.getBoundingClientRect();
		const canvasRect = canvas?.getBoundingClientRect();
		if (!editorRect || !canvasRect) return null;
		const frameBounds = projectStageBodyFrameBounds({
			aspect: compositionSize.width / compositionSize.height,
			camera: resolveStageCameraForOrientation(stage.camera, engineState.transport.orientation),
			time: clampNumber(animState.globalProgress, 0, 1),
			model,
			mesh: stageBodyMesh
		});
		if (!frameBounds) return null;
		return clipStageBodyRegion(
			canvasHitRegion({
				left: canvasRect.left - editorRect.left + frameBounds.left * canvasRect.width,
				top: canvasRect.top - editorRect.top + frameBounds.top * canvasRect.height,
				width: frameBounds.width * canvasRect.width,
				height: frameBounds.height * canvasRect.height
			})
		);
	}

	// A body often runs past the frame as the camera pushes in; its outline
	// stops at the frame like the picture does, instead of crossing the chrome.
	function clipStageBodyRegion(
		region: CanvasHitRegionGeometry | null
	): CanvasHitRegionGeometry | null {
		const clip = currentVisibleCanvasEditorBounds();
		if (!region || !clip) return region;
		const left = Math.max(region.visibleBounds.left, clip.left);
		const top = Math.max(region.visibleBounds.top, clip.top);
		const right = Math.min(
			region.visibleBounds.left + region.visibleBounds.width,
			clip.left + clip.width
		);
		const bottom = Math.min(
			region.visibleBounds.top + region.visibleBounds.height,
			clip.top + clip.height
		);
		if (right <= left || bottom <= top) return null;
		return { ...region, visibleBounds: { left, top, width: right - left, height: bottom - top } };
	}

	// The bodies the Overlays contribute (ADR-0062), each selected exactly where
	// the stage draws it: the same resolution the frame renderer runs, through
	// the same rig at the playhead, projected vertex by vertex.
	interface OverlayBodyHitRegion {
		overlay: Overlay;
		index: number;
		region: CanvasHitRegionGeometry;
	}

	function overlayBodyHitRegions(): OverlayBodyHitRegion[] {
		const stage = engineState.stage;
		if (!stage || stage.type !== 'depth') return [];
		if (compositionSize.width === 0 || compositionSize.height === 0) return [];
		void measureEpoch;
		const editorRect = rootEl?.getBoundingClientRect();
		const canvasRect = canvas?.getBoundingClientRect();
		if (!editorRect || !canvasRect) return [];
		const aspect = compositionSize.width / compositionSize.height;
		const rig = createStageCameraRig({
			aspect,
			camera: resolveStageCameraForOrientation(stage.camera, engineState.transport.orientation),
			time: clampNumber(animState.globalProgress, 0, 1)
		});
		const bodies = resolveOverlayStageBodies({
			overlays: engineState.overlays,
			pack: getPack(packState.slug),
			typeface: stageTypeface,
			overlayChannels: animState.overlayChannels,
			overlayProgresses: animState.overlayProgresses,
			rig,
			aspect,
			orientation: engineState.transport.orientation
		});
		const regions: OverlayBodyHitRegion[] = [];
		for (const { overlay, index, body } of bodies) {
			const frameBounds = projectStageMeshFrameBounds({
				viewProjection: rig.viewProjection,
				model: body.model,
				mesh: body.mesh
			});
			if (!frameBounds) continue;
			const region = clipStageBodyRegion(
				canvasHitRegion({
					left: canvasRect.left - editorRect.left + frameBounds.left * canvasRect.width,
					top: canvasRect.top - editorRect.top + frameBounds.top * canvasRect.height,
					width: frameBounds.width * canvasRect.width,
					height: frameBounds.height * canvasRect.height
				})
			);
			if (region) regions.push({ overlay, index, region });
		}
		return regions;
	}

	interface CanvasDragSnapGesture {
		movingElement: CanvasAlignableElement;
		compatibleElements: CanvasAlignableElement[];
		orientation: 'horizontal' | 'vertical';
		plane: StagePlane;
	}

	interface ActiveCanvasSnapGuide {
		guide: CanvasSnapGuide;
		plane: StagePlane;
	}

	interface CanvasSnapGuideLine {
		start: CanvasInteractionPoint;
		end: CanvasInteractionPoint;
	}

	let activeCanvasSnapGuides = $state.raw<ActiveCanvasSnapGuide[]>([]);

	function createCanvasDragSnapGesture(
		selectionKey: CanvasElementSelectionKey,
		plane: StagePlane
	): CanvasDragSnapGesture | null {
		const movingElement = canvasAlignableElement(selectionKey);
		if (!movingElement) return null;
		return {
			movingElement,
			compatibleElements: allCanvasAlignableElements(),
			orientation: engineState.transport.orientation,
			plane
		};
	}

	function canvasSnapScreenScale(plane: StagePlane): CanvasInteractionPoint | null {
		const geometry = currentCanvasInteractionGeometry();
		const horizontalStart = geometry?.compositionPointToScreen({ x: 0, y: 0.5 }, plane);
		const horizontalEnd = geometry?.compositionPointToScreen({ x: 1, y: 0.5 }, plane);
		const verticalStart = geometry?.compositionPointToScreen({ x: 0.5, y: 0 }, plane);
		const verticalEnd = geometry?.compositionPointToScreen({ x: 0.5, y: 1 }, plane);
		if (!horizontalStart || !horizontalEnd || !verticalStart || !verticalEnd) return null;
		return {
			x: Math.hypot(horizontalEnd.x - horizontalStart.x, horizontalEnd.y - horizontalStart.y),
			y: Math.hypot(verticalEnd.x - verticalStart.x, verticalEnd.y - verticalStart.y)
		};
	}

	function resolveCanvasGestureDelta(
		event: PointerEvent,
		gesture: CanvasDragSnapGesture | null,
		proposedDelta: CanvasInteractionPoint
	): CanvasInteractionPoint {
		if (
			!gesture ||
			gesture.orientation !== engineState.transport.orientation ||
			isCanvasSnapBypassGesture(event)
		) {
			activeCanvasSnapGuides = [];
			return proposedDelta;
		}
		const screenScale = canvasSnapScreenScale(gesture.plane);
		if (!screenScale) {
			activeCanvasSnapGuides = [];
			return proposedDelta;
		}
		const result = resolveCanvasDragSnapping({
			movingElement: gesture.movingElement,
			proposedDelta,
			compatibleElements: gesture.compatibleElements,
			orientation: gesture.orientation,
			screenScale
		});
		activeCanvasSnapGuides = result.guides.map((guide) => ({ guide, plane: gesture.plane }));
		return result.delta;
	}

	function canvasSnapGuideLine(activeGuide: ActiveCanvasSnapGuide): CanvasSnapGuideLine | null {
		void measureEpoch;
		const geometry = currentCanvasInteractionGeometry();
		const editorBounds = rootEl?.getBoundingClientRect();
		if (!geometry || !editorBounds) return null;
		const { guide, plane } = activeGuide;
		const normalizedStart =
			guide.axis === 'x'
				? { x: guide.position, y: guide.start }
				: { x: guide.start, y: guide.position };
		const normalizedEnd =
			guide.axis === 'x'
				? { x: guide.position, y: guide.end }
				: { x: guide.end, y: guide.position };
		const screenStart = geometry.compositionPointToScreen(normalizedStart, plane);
		const screenEnd = geometry.compositionPointToScreen(normalizedEnd, plane);
		if (!screenStart || !screenEnd) return null;
		return {
			start: { x: screenStart.x - editorBounds.left, y: screenStart.y - editorBounds.top },
			end: { x: screenEnd.x - editorBounds.left, y: screenEnd.y - editorBounds.top }
		};
	}

	// Pointer → normalized composition coordinate on an element's plane. The
	// contract also derives native coordinates for consumers that need them;
	// authored overlay/diagram placement persists normalized values.
	function pointerToComp(
		clientX: number,
		clientY: number,
		plane: StagePlane
	): { x: number; y: number } | null {
		return (
			currentCanvasInteractionGeometry()?.screenPointToComposition(
				{ x: clientX, y: clientY },
				plane
			)?.normalized ?? null
		);
	}

	function overlayRelRect(
		overlay: Overlay
	): { left: number; top: number; width: number; height: number } | null {
		// Subscribe to the overlay's position so the hit box re-measures after a drag
		// or inspector edit moves it — getBoundingClientRect itself isn't reactive, so
		// without these reads the box would stick to the overlay's original spot.
		const placement = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);
		void placement.anchor;
		void placement.offset?.x;
		void placement.offset?.y;
		void placement.rect?.x;
		void placement.rect?.y;
		void placement.rect?.width;
		void placement.rect?.height;
		void placement.scale;
		void placement.rotation;
		const el = getOverlayEl(overlay);
		if (!el) return null;
		return projectRect(el, overlayPlane(overlay));
	}

	// The overlay's current top-left, as a 0..1 fraction of the composition. Used
	// to seed a `center` overlay's conversion to free placement on drag (so it
	// doesn't jump) — `center` ignores `offset`, so it can't be nudged in place.
	function measureTopLeftFrac(overlay: Overlay): { x: number; y: number } | null {
		const el = getOverlayEl(overlay);
		if (!el) return null;
		const bounds = currentCanvasInteractionGeometry()?.renderedBoundsFor(
			canvasInteractionRect(el.getBoundingClientRect()),
			overlayPlane(overlay)
		)?.compositionBounds.normalized;
		return bounds ? { x: bounds.left, y: bounds.top } : null;
	}

	// ─── Drag state ──────────────────────────────────────────────────────────────

	const CANVAS_DRAG_AUTHORING_PRECISION = 1_000_000;

	function canvasDragAuthoringValue(value: number): number {
		const rounded =
			Math.round(clampNumber(value, 0, 1) * CANVAS_DRAG_AUTHORING_PRECISION) /
			CANVAS_DRAG_AUTHORING_PRECISION;
		return Object.is(rounded, -0) ? 0 : rounded;
	}

	interface DragState {
		overlayId: string;
		/** Drag origin in composition fractions (ray-cast onto the overlay plane). */
		startCompX: number;
		startCompY: number;
		/** Which representation the drag writes: `offset` (edge-anchored) or `rect`
		 *  (normalized-rect). */
		mode: 'offset' | 'rect';
		/** Origin value in the active representation (offset.x / rect.x …). */
		originX: number;
		originY: number;
		/** A `center`-anchored overlay converts to free `top-left` placement on the
		 *  first real move; this seeds the post-conversion origin. */
		convertCenter: boolean;
		moved: boolean;
		snap: CanvasDragSnapGesture | null;
	}

	let dragState: DragState | null = null;

	function onPointerDown(event: PointerEvent, overlay: Overlay): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const pos = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);
		const isRect = pos.anchor === 'normalized-rect';
		const measured = measureTopLeftFrac(overlay);
		// Centre-family anchors ignore `offset` on their centred axis, so a drag
		// converts them to free `top-left` placement (seeded from the measured
		// position so nothing jumps) — full `center` and the x-centred
		// `top-center`/`bottom-center` alike.
		const convertCenter =
			(pos.anchor === 'center' || pos.anchor === 'top-center' || pos.anchor === 'bottom-center') &&
			measured !== null;
		const startComp = pointerToComp(event.clientX, event.clientY, overlayPlane(overlay));
		if (!startComp) return;
		dragState = {
			overlayId: overlay.id,
			startCompX: startComp.x,
			startCompY: startComp.y,
			mode: isRect ? 'rect' : 'offset',
			// For a center overlay we seed from the measured top-left so the post-
			// conversion top-left anchor keeps the same on-screen position.
			originX: isRect ? (pos.rect?.x ?? 0) : convertCenter ? measured!.x : (pos.offset?.x ?? 0),
			originY: isRect ? (pos.rect?.y ?? 0) : convertCenter ? measured!.y : (pos.offset?.y ?? 0),
			convertCenter,
			moved: false,
			snap: createCanvasDragSnapGesture(`overlay:${overlay.id}`, overlayPlane(overlay))
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
			window.addEventListener('pointercancel', onPointerUp);
		}
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragState) return;
		const overlay = engineState.overlays.find((o) => o.id === dragState!.overlayId);
		if (!overlay) return;
		// Pointer → composition-fraction delta (offset.x is a fraction of
		// inline-size, offset.y of block-size), ray-cast onto the overlay's plane
		// so the drag tracks the reprojected pixels when the stage is on.
		const comp = pointerToComp(event.clientX, event.clientY, overlayPlaneById(dragState.overlayId));
		if (!comp) return;
		const proposedDelta = {
			x: comp.x - dragState.startCompX,
			y: comp.y - dragState.startCompY
		};
		const pos = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);

		// Ignore sub-pixel jitter so a plain click doesn't count as a drag (and so a
		// center overlay isn't reanchored just by selecting it).
		if (!dragState.moved) {
			if (Math.abs(proposedDelta.x) < 0.0005 && Math.abs(proposedDelta.y) < 0.0005) return;
			dragState.moved = true;
			if (dragState.convertCenter) {
				pos.anchor = 'top-left';
			}
		}
		const delta = resolveCanvasGestureDelta(event, dragState.snap, proposedDelta);

		if (dragState.mode === 'rect') {
			if (!pos.rect) return;
			pos.rect.x = canvasDragAuthoringValue(dragState.originX + delta.x);
			pos.rect.y = canvasDragAuthoringValue(dragState.originY + delta.y);
			return;
		}

		// Offset is an INSET from the anchor edge: `right`/`bottom` anchors map to CSS
		// right/bottom, so moving toward the far edge DECREASES the offset. Sign the
		// delta per anchor edge so the overlay tracks the cursor.
		if (!pos.offset) pos.offset = { x: 0, y: 0 };
		const horizSign = pos.anchor.endsWith('right') ? -1 : 1;
		const vertSign = pos.anchor.startsWith('bottom') ? -1 : 1;
		pos.offset.x = canvasDragAuthoringValue(dragState.originX + horizSign * delta.x);
		pos.offset.y = canvasDragAuthoringValue(dragState.originY + vertSign * delta.y);
	}

	function onPointerUp(): void {
		dragState = null;
		activeCanvasSnapGuides = [];
		if (typeof window !== 'undefined') {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
		}
	}

	// ─── Scale state ───────────────────────────────────────────────────────────────
	// Uniform scale about the anchor point. The anchor's transform-origin corner
	// stays fixed in screen space as the overlay scales, so a corner handle's
	// distance from that point is a direct measure of scale: drag it out → bigger.

	type OverlayPlacementScalar = 'scale' | 'rotation';

	function recordOverlayPlacementScalarChange(
		label: string,
		placement: OverlayPlacement,
		key: OverlayPlacementScalar,
		before: number | undefined,
		after: number | undefined
	): void {
		if (Object.is(before, after)) return;
		compositionEditHistory.recordApplied({
			label,
			undo: () => {
				placement[key] = before;
				measureEpoch += 1;
			},
			redo: () => {
				placement[key] = after;
				measureEpoch += 1;
			}
		});
	}

	function roundedCanvasScalar(value: number, minimum: number, maximum: number): number {
		return Math.round(clampNumber(value, minimum, maximum) * 1_000_000) / 1_000_000;
	}

	interface ScaleState {
		orientation: 'horizontal' | 'vertical';
		placement: OverlayPlacement;
		scaleBefore: number | undefined;
		/** The fixed anchor point in client px (the overlay's transform-origin corner). */
		anchorX: number;
		anchorY: number;
		/** Distance anchor→grabbed-corner at drag start; the scale denominator. */
		d0: number;
		scaleOrigin: number;
	}

	let scaleState: ScaleState | null = null;

	/** Corner of the overlay box that an anchor pins (matches OverlayMount's
	 *  anchorOrigin); the scale grows from there. */
	function anchorPoint(
		anchor: OverlayPlacement['anchor'],
		rect: DOMRect
	): { x: number; y: number } {
		const x =
			anchor === 'normalized-rect' || anchor.endsWith('left')
				? rect.left
				: anchor.endsWith('right')
					? rect.right
					: rect.left + rect.width / 2;
		const y =
			anchor === 'normalized-rect' || anchor.startsWith('top')
				? rect.top
				: anchor.startsWith('bottom')
					? rect.bottom
					: rect.top + rect.height / 2;
		return { x, y };
	}

	function onScaleStart(event: PointerEvent, overlay: Overlay): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectLayer(createTimelineTrackId({ kind: 'overlay', overlayId: overlay.id }));
		// Anchor point must be in the SAME space as the pointer (client/display px).
		// Pointer padding lives on the outer hit region, so measure the nested
		// visible outline rather than either the padded region or native-4K DOM.
		const hitEl = (event.currentTarget as HTMLElement).closest<HTMLElement>('.overlay-hit');
		const outlineEl = hitEl?.querySelector<HTMLElement>('.canvas-selection-outline');
		if (!outlineEl) return;
		const placement = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);
		const { x: anchorX, y: anchorY } = anchorPoint(
			placement.anchor,
			outlineEl.getBoundingClientRect()
		);
		const d0 = Math.hypot(event.clientX - anchorX, event.clientY - anchorY);
		if (d0 < 4) return; // grabbed essentially at the anchor — no scale axis
		scaleState = {
			orientation: engineState.transport.orientation,
			placement,
			scaleBefore: placement.scale,
			anchorX,
			anchorY,
			d0,
			scaleOrigin: placement.scale ?? 1
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onScaleMove);
			window.addEventListener('pointerup', onScaleEnd);
			window.addEventListener('pointercancel', onScaleCancel);
		}
	}

	function onScaleMove(event: PointerEvent): void {
		const state = scaleState;
		if (!state) return;
		if (engineState.transport.orientation !== state.orientation) {
			onScaleCancel();
			return;
		}
		const d1 = Math.hypot(event.clientX - state.anchorX, event.clientY - state.anchorY);
		state.placement.scale = roundedCanvasScalar((state.scaleOrigin * d1) / state.d0, 0.1, 8);
	}

	function removeScaleListeners(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('pointermove', onScaleMove);
		window.removeEventListener('pointerup', onScaleEnd);
		window.removeEventListener('pointercancel', onScaleCancel);
	}

	function onScaleEnd(): void {
		const state = scaleState;
		scaleState = null;
		removeScaleListeners();
		if (!state) return;
		recordOverlayPlacementScalarChange(
			'Scale canvas overlay',
			state.placement,
			'scale',
			state.scaleBefore,
			state.placement.scale
		);
	}

	function onScaleCancel(): void {
		const state = scaleState;
		scaleState = null;
		removeScaleListeners();
		if (!state) return;
		state.placement.scale = state.scaleBefore;
		measureEpoch += 1;
	}

	function onScaleKeyDown(event: KeyboardEvent, overlay: Overlay): void {
		const direction =
			event.key === 'ArrowUp' || event.key === 'ArrowRight'
				? 1
				: event.key === 'ArrowDown' || event.key === 'ArrowLeft'
					? -1
					: 0;
		if (direction === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		event.stopPropagation();
		const placement = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);
		const before = placement.scale;
		placement.scale = roundedCanvasScalar(
			(before ?? 1) + direction * (event.shiftKey ? 0.25 : 0.05),
			0.1,
			8
		);
		recordOverlayPlacementScalarChange(
			'Scale canvas overlay',
			placement,
			'scale',
			before,
			placement.scale
		);
	}

	// ─── Rotate state (ADR-0035; absorbs 5vcak6og) ───────────────────────────────
	// Static rotation about the anchor point, mirroring the scale handles: the
	// handle's angle around the transform-origin is a direct read of rotation.

	interface RotateState {
		orientation: 'horizontal' | 'vertical';
		placement: OverlayPlacement;
		rotationBefore: number | undefined;
		anchorX: number;
		anchorY: number;
		/** Pointer angle (deg) around the anchor at drag start. */
		angle0: number;
		rotationOrigin: number;
	}

	let rotateState: RotateState | null = null;

	function pointerAngle(event: PointerEvent, anchorX: number, anchorY: number): number {
		return (Math.atan2(event.clientY - anchorY, event.clientX - anchorX) * 180) / Math.PI;
	}

	// The stage camera's aim is edited in the stage section, not on the canvas:
	// a drag handle on the aimed page point re-projects the whole page under
	// the pointer and fights the hand (removed 2026-09-02 after review).

	function onRotateStart(event: PointerEvent, overlay: Overlay): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectLayer(createTimelineTrackId({ kind: 'overlay', overlayId: overlay.id }));
		const hitEl = (event.currentTarget as HTMLElement).closest<HTMLElement>('.overlay-hit');
		const outlineEl = hitEl?.querySelector<HTMLElement>('.canvas-selection-outline');
		if (!outlineEl) return;
		const placement = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);
		const { x: anchorX, y: anchorY } = anchorPoint(
			placement.anchor,
			outlineEl.getBoundingClientRect()
		);
		rotateState = {
			orientation: engineState.transport.orientation,
			placement,
			rotationBefore: placement.rotation,
			anchorX,
			anchorY,
			angle0: pointerAngle(event, anchorX, anchorY),
			rotationOrigin: placement.rotation ?? 0
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onRotateMove);
			window.addEventListener('pointerup', onRotateEnd);
			window.addEventListener('pointercancel', onRotateCancel);
		}
	}

	function onRotateMove(event: PointerEvent): void {
		const state = rotateState;
		if (!state) return;
		if (engineState.transport.orientation !== state.orientation) {
			onRotateCancel();
			return;
		}
		let delta = pointerAngle(event, state.anchorX, state.anchorY) - state.angle0;
		// Take the short way around so crossing the ±180° seam doesn't jump.
		if (delta > 180) delta -= 360;
		if (delta < -180) delta += 360;
		state.placement.rotation = roundedCanvasScalar(state.rotationOrigin + delta, -360, 360);
	}

	function removeRotateListeners(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('pointermove', onRotateMove);
		window.removeEventListener('pointerup', onRotateEnd);
		window.removeEventListener('pointercancel', onRotateCancel);
	}

	function onRotateEnd(): void {
		const state = rotateState;
		rotateState = null;
		removeRotateListeners();
		if (!state) return;
		recordOverlayPlacementScalarChange(
			'Rotate canvas overlay',
			state.placement,
			'rotation',
			state.rotationBefore,
			state.placement.rotation
		);
	}

	function onRotateCancel(): void {
		const state = rotateState;
		rotateState = null;
		removeRotateListeners();
		if (!state) return;
		state.placement.rotation = state.rotationBefore;
		measureEpoch += 1;
	}

	function onRotateKeyDown(event: KeyboardEvent, overlay: Overlay): void {
		const direction =
			event.key === 'ArrowUp' || event.key === 'ArrowRight'
				? 1
				: event.key === 'ArrowDown' || event.key === 'ArrowLeft'
					? -1
					: 0;
		if (direction === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		event.stopPropagation();
		const placement = resolveOverlayPlacement(overlay.position, engineState.transport.orientation);
		const before = placement.rotation;
		placement.rotation = roundedCanvasScalar(
			(before ?? 0) + direction * (event.shiftKey ? 15 : 1),
			-360,
			360
		);
		recordOverlayPlacementScalarChange(
			'Rotate canvas overlay',
			placement,
			'rotation',
			before,
			placement.rotation
		);
	}

	// ─── Diagram primitive Blocks (ADR-0036): click-select + drag placement ─────
	// Explicit placement IS the authoring model — the canvas drag writes the
	// primitive's composition-fraction position directly (a segment translates
	// both endpoints as one span). Edges have no DOM box; they re-route live as
	// their nodes move and are selected/edited from the timeline + inspector.

	const diagramPrimitiveDraggables = $derived(
		(engineState.surface.diagram ?? []).filter((primitive) => primitive.type !== 'edge-arrow')
	);

	function blockRenderedBounds(primitive: DiagramPrimitive): CanvasRenderedBounds | null {
		// DOM bounds are not reactive. Zoom, pan, orientation, and ResizeObserver
		// updates advance this editor-only epoch so Block hit regions and handles
		// reproject with the canvas instead of keeping stale screen geometry.
		void measureEpoch;
		const element = compositionElement?.querySelector<HTMLElement>(
			`[data-diagram-primitive="${CSS.escape(primitive.id)}"]`
		);
		if (!element) return null;
		return (
			currentCanvasInteractionGeometry()?.renderedBoundsFor(
				canvasInteractionRect(element.getBoundingClientRect()),
				'surface'
			) ?? null
		);
	}

	const kineticWordDraggables = $derived(engineState.surface.typeField?.words ?? []);

	function kineticWordRelRect(
		word: KineticWord
	): { left: number; top: number; width: number; height: number } | null {
		void measureEpoch;
		void JSON.stringify(resolveKineticWordGeometry(word, engineState.transport.orientation));
		const element = compositionElement?.querySelector<HTMLElement>(
			`[data-kinetic-word="${CSS.escape(word.id)}"]`
		);
		return element ? projectRect(element) : null;
	}

	function blockRelRect(
		primitive: DiagramPrimitive
	): { left: number; top: number; width: number; height: number } | null {
		// Subscribe to the authored geometry so the hit box re-measures after a
		// drag, width reflow, or inspector edit (getBoundingClientRect isn't reactive).
		switch (primitive.type) {
			case 'node':
			case 'stat-callout': {
				const geometry = resolveDiagramPrimitiveGeometry(
					primitive,
					engineState.transport.orientation
				);
				void geometry.position.x;
				void geometry.position.y;
				void geometry.scale;
				break;
			}
			case 'label': {
				const geometry = resolveDiagramPrimitiveGeometry(
					primitive,
					engineState.transport.orientation
				);
				void geometry.position.x;
				void geometry.position.y;
				void geometry.scale;
				void geometry.maxWidth;
				break;
			}
			case 'timeline-segment': {
				const geometry = resolveDiagramPrimitiveGeometry(
					primitive,
					engineState.transport.orientation
				);
				void JSON.stringify(geometry.from);
				void JSON.stringify(geometry.to);
				break;
			}
			case 'edge-arrow':
				break;
		}
		return blockRenderedBounds(primitive)?.editorBounds ?? null;
	}

	interface BlockDragState {
		blockId: string;
		/** Drag origin in composition fractions (ray-cast onto the surface plane). */
		startCompX: number;
		startCompY: number;
		/** Every authored point the drag translates (position, or from+to). */
		points: { point: { x: number; y: number }; originX: number; originY: number }[];
		snap: CanvasDragSnapGesture | null;
	}

	let blockDrag: BlockDragState | null = null;

	function onBlockPointerDown(event: PointerEvent, primitive: DiagramPrimitive): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const points: BlockDragState['points'] = [];
		switch (primitive.type) {
			case 'node':
			case 'label':
			case 'stat-callout': {
				const geometry = resolveDiagramPrimitiveGeometry(
					primitive,
					engineState.transport.orientation
				);
				points.push({
					point: geometry.position,
					originX: geometry.position.x,
					originY: geometry.position.y
				});
				break;
			}
			case 'timeline-segment': {
				const geometry = resolveDiagramPrimitiveGeometry(
					primitive,
					engineState.transport.orientation
				);
				points.push({
					point: geometry.from,
					originX: geometry.from.x,
					originY: geometry.from.y
				});
				points.push({
					point: geometry.to,
					originX: geometry.to.x,
					originY: geometry.to.y
				});
				break;
			}
			case 'edge-arrow':
				break;
		}
		if (points.length === 0) return;
		const startComp = pointerToComp(event.clientX, event.clientY, 'surface');
		if (!startComp) return;
		blockDrag = {
			blockId: primitive.id,
			startCompX: startComp.x,
			startCompY: startComp.y,
			points,
			snap: createCanvasDragSnapGesture(`block:${primitive.id}`, 'surface')
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onBlockPointerMove);
			window.addEventListener('pointerup', onBlockPointerUp);
			window.addEventListener('pointercancel', onBlockPointerUp);
		}
	}

	function onBlockPointerMove(event: PointerEvent): void {
		if (!blockDrag) return;
		const comp = pointerToComp(event.clientX, event.clientY, 'surface');
		if (!comp) return;
		const proposedDelta = {
			x: comp.x - blockDrag.startCompX,
			y: comp.y - blockDrag.startCompY
		};
		if (Math.abs(proposedDelta.x) < 0.0005 && Math.abs(proposedDelta.y) < 0.0005) return;
		const delta = resolveCanvasGestureDelta(event, blockDrag.snap, proposedDelta);
		for (const entry of blockDrag.points) {
			// Rounded to 4 dp — sub-pixel-at-4K precision that keeps the inspector
			// and the serialized preset readable.
			entry.point.x = Math.round(clampNumber(entry.originX + delta.x, 0, 1) * 10000) / 10000;
			entry.point.y = Math.round(clampNumber(entry.originY + delta.y, 0, 1) * 10000) / 10000;
		}
	}

	function onBlockPointerUp(): void {
		blockDrag = null;
		activeCanvasSnapGuides = [];
		if (typeof window !== 'undefined') {
			window.removeEventListener('pointermove', onBlockPointerMove);
			window.removeEventListener('pointerup', onBlockPointerUp);
			window.removeEventListener('pointercancel', onBlockPointerUp);
		}
	}

	interface KineticWordDragState {
		wordId: string;
		scope: 'shared' | 'horizontal' | 'vertical';
		expectedRevision: number;
		startCompX: number;
		startCompY: number;
		origin: KineticWordGeometry;
		target: KineticWordGeometry;
		atMs: number;
		originChannelX: number;
		originChannelY: number;
		snap: CanvasDragSnapGesture | null;
	}

	let kineticWordDrag: KineticWordDragState | null = null;

	function removeKineticWordDragListeners(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('pointermove', onKineticWordPointerMove);
		window.removeEventListener('pointerup', commitKineticWordDrag);
		window.removeEventListener('pointercancel', cancelKineticWordDrag);
	}

	function onKineticWordPointerDown(event: PointerEvent, word: KineticWord): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const start = pointerToComp(event.clientX, event.clientY, 'surface');
		if (!start) return;
		const orientation = engineState.transport.orientation;
		const override = word.orientationOverrides?.[orientation];
		const target: KineticWordGeometry = override ?? word;
		const atMs = (timelineHandle.current?.time ?? 0) * 1000;
		const writesMotion = atMs > 0;
		const liveChannels = animState.kineticWordChannels[word.id];
		kineticWordDrag = {
			wordId: word.id,
			scope: writesMotion ? orientation : override ? orientation : 'shared',
			expectedRevision: compositionEditHistory.revision,
			startCompX: start.x,
			startCompY: start.y,
			origin: cloneKineticWordGeometry(target),
			target,
			atMs: writesMotion ? atMs : 0,
			originChannelX: liveChannels?.x ?? 0,
			originChannelY: liveChannels?.y ?? 0,
			snap: createCanvasDragSnapGesture(`block:${word.id}`, 'surface')
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onKineticWordPointerMove);
			window.addEventListener('pointerup', commitKineticWordDrag);
			window.addEventListener('pointercancel', cancelKineticWordDrag);
		}
	}

	function onKineticWordPointerMove(event: PointerEvent): void {
		const drag = kineticWordDrag;
		if (!drag) return;
		const current = pointerToComp(event.clientX, event.clientY, 'surface');
		if (!current) return;
		const proposedDelta = {
			x: current.x - drag.startCompX,
			y: current.y - drag.startCompY
		};
		if (Math.abs(proposedDelta.x) < 0.0005 && Math.abs(proposedDelta.y) < 0.0005) return;
		const delta = resolveCanvasGestureDelta(event, drag.snap, proposedDelta);
		drag.target.position.x =
			Math.round(clampNumber(drag.origin.position.x + delta.x, 0, 1) * 10000) / 10000;
		drag.target.position.y =
			Math.round(clampNumber(drag.origin.position.y + delta.y, 0, 1) * 10000) / 10000;
	}

	async function commitKineticWordDrag(): Promise<void> {
		const drag = kineticWordDrag;
		kineticWordDrag = null;
		activeCanvasSnapGuides = [];
		removeKineticWordDragListeners();
		if (!drag) return;
		const finalGeometry = cloneKineticWordGeometry(drag.target);
		drag.target.position.x = drag.origin.position.x;
		drag.target.position.y = drag.origin.position.y;
		if (
			finalGeometry.position.x === drag.origin.position.x &&
			finalGeometry.position.y === drag.origin.position.y
		) {
			return;
		}
		if (drag.atMs > 0 && drag.scope !== 'shared') {
			await runSetCompositionKineticWordPositionKeyframeOperation({
				expectedRevision: drag.expectedRevision,
				wordId: drag.wordId,
				scope: drag.scope,
				atMs: drag.atMs,
				x: drag.originChannelX + (finalGeometry.position.x - drag.origin.position.x),
				y: drag.originChannelY + (finalGeometry.position.y - drag.origin.position.y)
			});
			return;
		}
		await runSetCompositionKineticWordPlacementOperation({
			expectedRevision: drag.expectedRevision,
			wordId: drag.wordId,
			scope: drag.scope,
			geometry: finalGeometry
		});
	}

	function cancelKineticWordDrag(): void {
		const drag = kineticWordDrag;
		kineticWordDrag = null;
		activeCanvasSnapGuides = [];
		removeKineticWordDragListeners();
		if (!drag) return;
		drag.target.position.x = drag.origin.position.x;
		drag.target.position.y = drag.origin.position.y;
	}

	// ─── Diagram label text-box resize ───────────────────────────────────────────
	// Labels are the existing bounded text-container domain. Side handles write
	// maxWidth in normalized composition space; the label mount reflows height
	// intrinsically and leaves scale/font size unchanged.

	interface TextBoxResizeState {
		origin: DiagramLabelTextBoxSnapshot;
		side: CanvasTextBoxResizeSide;
		startCompX: number;
		intrinsicWidth: number;
	}

	let textBoxResizeState: TextBoxResizeState | null = null;

	function removeTextBoxResizeListeners(): void {
		if (typeof window === 'undefined') return;
		window.removeEventListener('pointermove', onTextBoxResizeMove);
		window.removeEventListener('pointerup', commitTextBoxResize);
		window.removeEventListener('pointercancel', cancelTextBoxResize);
	}

	function onTextBoxResizeStart(
		event: PointerEvent,
		label: DiagramLabel,
		side: CanvasTextBoxResizeSide
	): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const start = pointerToComp(event.clientX, event.clientY, 'surface');
		const renderedBounds = blockRenderedBounds(label);
		const origin = captureDiagramLabelTextBoxSnapshot(engineState, label.id);
		if (!start || !renderedBounds || !origin) return;
		const intrinsicWidth = renderedBounds.compositionBounds.normalized.width;
		if (!Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0) return;
		const selectionKey = `block:${label.id}` as CanvasElementSelectionKey;
		selectSpatialCanvasElement(selectionKey, 'replace');
		textBoxResizeState = { origin, side, startCompX: start.x, intrinsicWidth };
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onTextBoxResizeMove);
			window.addEventListener('pointerup', commitTextBoxResize);
			window.addEventListener('pointercancel', cancelTextBoxResize);
		}
	}

	function onTextBoxResizeMove(event: PointerEvent): void {
		const state = textBoxResizeState;
		if (!state) return;
		if (engineState.transport.orientation !== state.origin.orientation) {
			cancelTextBoxResize();
			return;
		}
		const current = pointerToComp(event.clientX, event.clientY, 'surface');
		if (!current) return;
		const resolved = resolveDiagramLabelTextBoxResize(state.origin, {
			side: state.side,
			deltaX: current.x - state.startCompX,
			intrinsicWidth: state.intrinsicWidth
		});
		if (!resolved) return;
		restoreDiagramLabelTextBoxSnapshot(engineState, resolved);
	}

	function commitTextBoxResize(): void {
		const state = textBoxResizeState;
		textBoxResizeState = null;
		removeTextBoxResizeListeners();
		if (!state) return;
		const finalSnapshot = captureDiagramLabelTextBoxSnapshot(engineState, state.origin.labelId);
		if (!finalSnapshot || finalSnapshot.orientation !== state.origin.orientation) {
			restoreDiagramLabelTextBoxSnapshot(engineState, state.origin);
			measureEpoch += 1;
			return;
		}
		if (diagramLabelTextBoxSnapshotsEqual(state.origin, finalSnapshot)) return;
		compositionEditHistory.recordApplied({
			label: 'Resize diagram label text box',
			undo: () => {
				restoreDiagramLabelTextBoxSnapshot(engineState, state.origin);
				measureEpoch += 1;
			},
			redo: () => {
				restoreDiagramLabelTextBoxSnapshot(engineState, finalSnapshot);
				measureEpoch += 1;
			}
		});
	}

	function cancelTextBoxResize(): void {
		const state = textBoxResizeState;
		textBoxResizeState = null;
		removeTextBoxResizeListeners();
		if (!state) return;
		restoreDiagramLabelTextBoxSnapshot(engineState, state.origin);
		measureEpoch += 1;
	}

	function onTextBoxResizeKeyDown(
		event: KeyboardEvent,
		label: DiagramLabel,
		side: CanvasTextBoxResizeSide
	): void {
		if (
			(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const renderedBounds = blockRenderedBounds(label);
		const origin = captureDiagramLabelTextBoxSnapshot(engineState, label.id);
		if (!renderedBounds || !origin) return;
		const intrinsicWidth = renderedBounds.compositionBounds.normalized.width;
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		const deltaX = (direction * (event.shiftKey ? 10 : 1)) / Math.max(1, compositionSize.width);
		const resolved = resolveDiagramLabelTextBoxResize(origin, {
			side,
			deltaX,
			intrinsicWidth
		});
		if (!resolved || diagramLabelTextBoxSnapshotsEqual(origin, resolved)) return;
		restoreDiagramLabelTextBoxSnapshot(engineState, resolved);
		measureEpoch += 1;
		compositionEditHistory.recordApplied({
			label: 'Resize diagram label text box',
			undo: () => {
				restoreDiagramLabelTextBoxSnapshot(engineState, origin);
				measureEpoch += 1;
			},
			redo: () => {
				restoreDiagramLabelTextBoxSnapshot(engineState, resolved);
				measureEpoch += 1;
			}
		});
	}

	// ─── Surface-interior direct selection (epic 0pkzts2c) ──────────────────────
	// Rendered surface content (iMessage bubbles, text slots) is live DOM inside
	// the canvas layoutsubtree, so its boxes project into display space with the
	// same math as overlays. A click selects the entity's existing address —
	// bubbles use the id from `createTimelineTrackId({ kind: 'surface-message', index })`;
	// slots select the surface
	// and request an inspector reveal — no dragging, these are content, not
	// spatially placed objects.

	const surfaceMessages = $derived(engineState.surface.content.messages ?? []);
	const surfaceItems = $derived(
		engineState.surface.type === 'checklist' ? (engineState.surface.content.items ?? []) : []
	);

	// Text-animation strategies rebuild slot DOM asynchronously (GSAP span
	// splits) — no engine state captures that, so boxes measured at mount can be
	// stale. Bumping this on backdrop pointerenter re-measures every interior box
	// before the cursor can reach one (regions are islands inside the backdrop).
	let measureEpoch = $state(0);

	const CANVAS_TRANSFORM_SETTLE_MS = 180;

	// CSS transforms do not notify ResizeObserver. Re-measure through the short
	// zoom transition, while ResizeObserver covers orientation and workspace
	// reflow. This attachment is editor-only and never enters frame rendering.
	const trackCanvasGeometryChanges: Attachment<HTMLDivElement> = (element) => {
		void zoom;
		void panX;
		void panY;
		void canvas;
		void compositionSize.width;
		void compositionSize.height;
		void engineState.transport.orientation;

		const startedAt = performance.now();
		let animationFrame = requestAnimationFrame(function refreshGeometry(now) {
			measureEpoch += 1;
			if (now - startedAt < CANVAS_TRANSFORM_SETTLE_MS) {
				animationFrame = requestAnimationFrame(refreshGeometry);
			}
		});
		const resizeObserver = new ResizeObserver(() => {
			measureEpoch += 1;
		});
		resizeObserver.observe(element);
		if (canvas) resizeObserver.observe(canvas);

		return () => {
			cancelAnimationFrame(animationFrame);
			resizeObserver.disconnect();
		};
	};

	// Every slot value stamped as `data-text-anim-slot` by surface CanvasSources.
	const SURFACE_TEXT_SLOTS = [
		'kicker',
		'title',
		'counterpoint',
		'body',
		'sourceUrl',
		'author',
		'source',
		'dateLabel'
	] as const;

	function messageRelRect(
		message: ChatMessage,
		index: number
	): { left: number; top: number; width: number; height: number } | null {
		// Bubble DOM moves with the playhead (enter pops, thread slide, window
		// visibility ramp) and reflows on content edits — subscribe so the hit box
		// tracks it (getBoundingClientRect isn't reactive).
		void animState.globalProgress;
		void animState.paperVisibility;
		void measureEpoch;
		void JSON.stringify(message);
		// When the typing indicator is up it renders before the (invisible) bubble,
		// so the first `data-message-index` match is always the visible box.
		const el = compositionElement?.querySelector<HTMLElement>(`[data-message-index="${index}"]`);
		if (!el) return null;
		return projectRect(el);
	}

	function slotRelRect(
		slot: (typeof SURFACE_TEXT_SLOTS)[number]
	): { left: number; top: number; width: number; height: number } | null {
		// Slot elements come and go with surface type/variant/content and ride the
		// surface's enter/exit — subscribe so the box re-measures.
		void engineState.surface.type;
		void engineState.surface.variant;
		void engineState.surface.content[slot];
		void animState.globalProgress;
		void animState.paperVisibility;
		void measureEpoch;
		const candidates = compositionElement?.querySelectorAll<HTMLElement>(
			`[data-text-anim-slot="${slot}"]`
		);
		if (!candidates) return null;
		// Overlays stamp the same attribute for their own text motion, and message
		// bubbles render their text through DocumentBody (slot "body") — both boxes
		// belong to their own hit regions, not a surface slot.
		for (const el of candidates) {
			if (el.closest('[data-overlay-id]') === null && el.closest('[data-message-index]') === null)
				return projectRect(el);
		}
		return null;
	}

	function onMessageDown(event: PointerEvent, index: number): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectMessage(index);
	}

	function selectMessage(index: number): void {
		selectLayer(createTimelineTrackId({ kind: 'surface-message', index }));
		requestInspectorFocus(`message:${index}`);
	}

	// Checklist item rows (ADR-0040) — the messages pattern, per task: a click
	// selects the item's timeline-row id and reveals its inspector entry.
	function itemRelRect(
		item: ChecklistItem,
		index: number
	): { left: number; top: number; width: number; height: number } | null {
		// Rows ride the surface's enter travel/visibility and reflow on content
		// edits — subscribe so the hit box tracks them.
		void animState.globalProgress;
		void animState.paperVisibility;
		void measureEpoch;
		void JSON.stringify(item);
		const el = compositionElement?.querySelector<HTMLElement>(`[data-item-index="${index}"]`);
		if (!el) return null;
		return projectRect(el);
	}

	function onItemDown(event: PointerEvent, index: number): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectItem(index);
	}

	function selectItem(index: number): void {
		selectLayer(createTimelineTrackId({ kind: 'checklist-item', index }));
		requestInspectorFocus(`item:${index}`);
	}

	function onSlotDown(event: PointerEvent, slot: string): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectSlot(slot);
	}

	function selectSlot(slot: string): void {
		selectLayer(createTimelineTrackId({ kind: 'surface' }));
		requestInspectorFocus(`slot:${slot}`);
	}

	// ─── Shared pointer hit resolution ────────────────────────────────────────────
	// Every visible outline owns an independently padded pointer region. DOM stack
	// order only determines which region receives the browser event; the shared
	// geometry contract resolves all regions at that screen point so overlap order
	// and Option/Alt cycling stay deterministic.

	interface CanvasDomSelectionCandidate extends CanvasSelectionCandidate {
		selectionId: string;
	}

	function isCanvasSelectionLayer(value: string | undefined): value is CanvasSelectionLayer {
		return (
			value === 'stage-body' ||
			value === 'surface-text' ||
			value === 'surface-content' ||
			value === 'block' ||
			value === 'overlay'
		);
	}

	function canvasDomSelectionCandidates(): CanvasDomSelectionCandidate[] {
		if (!rootEl) return [];
		const candidates: CanvasDomSelectionCandidate[] = [];
		for (const element of rootEl.querySelectorAll<HTMLElement>('[data-canvas-selection-key]')) {
			const selectionKey = element.dataset.canvasSelectionKey;
			const selectionId = element.dataset.canvasSelectionId;
			const layer = element.dataset.canvasSelectionLayer;
			const paintIndex = Number(element.dataset.canvasPaintIndex);
			const stableId = element.dataset.canvasStableId;
			if (
				!selectionKey ||
				!selectionId ||
				!isCanvasSelectionLayer(layer) ||
				!Number.isInteger(paintIndex) ||
				!stableId
			) {
				continue;
			}
			candidates.push({
				selectionKey,
				selectionId,
				selectionOrder: { layer, paintIndex, stableId },
				pointerBounds: canvasInteractionRect(element.getBoundingClientRect())
			});
		}
		return candidates;
	}

	function currentCanvasSelectionKey(
		candidates: readonly CanvasDomSelectionCandidate[]
	): string | null {
		if (!layerSelection.id) return null;
		const selectedCandidates = candidates.filter(
			(candidate) => candidate.selectionId === layerSelection.id
		);
		if (
			lastCanvasSelectionKey &&
			selectedCandidates.some((candidate) => candidate.selectionKey === lastCanvasSelectionKey)
		) {
			return lastCanvasSelectionKey;
		}
		return selectedCandidates.length === 1 ? selectedCandidates[0].selectionKey : null;
	}

	function canvasSelectionIndex(selectionKey: string, prefix: string): number | null {
		if (!selectionKey.startsWith(prefix)) return null;
		const index = Number(selectionKey.slice(prefix.length));
		return Number.isInteger(index) && index >= 0 ? index : null;
	}

	function isSurfaceTextSlot(slot: string): slot is (typeof SURFACE_TEXT_SLOTS)[number] {
		return SURFACE_TEXT_SLOTS.some((candidate) => candidate === slot);
	}

	function selectCanvasCandidate(selectionKey: string): void {
		if (selectionKey.startsWith('overlay-body:')) {
			const overlayId = selectionKey.slice('overlay-body:'.length);
			if (engineState.overlays.some((overlay) => overlay.id === overlayId)) {
				selectLayer(createTimelineTrackId({ kind: 'overlay', overlayId }));
			}
			return;
		}
		if (selectionKey.startsWith('overlay:')) {
			const overlayId = selectionKey.slice('overlay:'.length);
			if (engineState.overlays.some((overlay) => overlay.id === overlayId)) {
				selectLayer(createTimelineTrackId({ kind: 'overlay', overlayId }));
			}
			return;
		}
		if (selectionKey.startsWith('block:')) {
			const blockId = selectionKey.slice('block:'.length);
			if (
				diagramPrimitiveDraggables.some((primitive) => primitive.id === blockId) ||
				kineticWordDraggables.some((word) => word.id === blockId)
			) {
				selectLayer(createTimelineTrackId({ kind: 'block', blockId }));
			}
			return;
		}
		const messageIndex = canvasSelectionIndex(selectionKey, 'message:');
		if (messageIndex !== null && messageIndex < surfaceMessages.length) {
			selectMessage(messageIndex);
			return;
		}
		const itemIndex = canvasSelectionIndex(selectionKey, 'item:');
		if (itemIndex !== null && itemIndex < surfaceItems.length) {
			selectItem(itemIndex);
			return;
		}
		if (selectionKey.startsWith('slot:')) {
			const slot = selectionKey.slice('slot:'.length);
			if (isSurfaceTextSlot(slot)) selectSlot(slot);
		}
	}

	function startCanvasCandidateGesture(event: PointerEvent, selectionKey: string): void {
		if (selectionKey.startsWith('stage-body:')) {
			selectStageBody(selectionKey.slice('stage-body:'.length));
			startStageOrbit(event);
			return;
		}
		if (selectionKey.startsWith('overlay-body:')) {
			// An Overlay's body is that Overlay: its row selects, and the hand on
			// it orbits the camera about the stage like any body (ADR-0060 §4).
			selectLayer(
				createTimelineTrackId({
					kind: 'overlay',
					overlayId: selectionKey.slice('overlay-body:'.length)
				})
			);
			startStageOrbit(event);
			return;
		}
		if (selectionKey.startsWith('overlay:')) {
			const overlayId = selectionKey.slice('overlay:'.length);
			const overlay = engineState.overlays.find((candidate) => candidate.id === overlayId);
			if (overlay) onPointerDown(event, overlay);
			return;
		}
		if (selectionKey.startsWith('block:')) {
			const blockId = selectionKey.slice('block:'.length);
			const word = kineticWordDraggables.find((candidate) => candidate.id === blockId);
			if (word) {
				onKineticWordPointerDown(event, word);
				return;
			}
			const primitive = diagramPrimitiveDraggables.find((candidate) => candidate.id === blockId);
			if (primitive) onBlockPointerDown(event, primitive);
			return;
		}
		const messageIndex = canvasSelectionIndex(selectionKey, 'message:');
		if (messageIndex !== null && messageIndex < surfaceMessages.length) {
			onMessageDown(event, messageIndex);
			return;
		}
		const itemIndex = canvasSelectionIndex(selectionKey, 'item:');
		if (itemIndex !== null && itemIndex < surfaceItems.length) {
			onItemDown(event, itemIndex);
			return;
		}
		if (selectionKey.startsWith('slot:')) {
			const slot = selectionKey.slice('slot:'.length);
			if (isSurfaceTextSlot(slot)) onSlotDown(event, slot);
		}
	}

	function onCanvasCandidatePointerDown(event: PointerEvent, fallbackSelectionKey: string): void {
		if (event.button !== 0) return;
		const candidates = canvasDomSelectionCandidates();
		const resolved = resolveCanvasSelectionCandidateAtPoint(
			candidates,
			{ x: event.clientX, y: event.clientY },
			{
				currentSelectionKey: currentCanvasSelectionKey(candidates),
				cycle: event.altKey
			}
		);
		const selectionKey = resolved?.selectionKey ?? fallbackSelectionKey;
		lastCanvasSelectionKey = selectionKey;
		if (isCanvasElementSelectionKey(selectionKey)) {
			if (event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				selectSpatialCanvasElement(selectionKey, 'toggle');
				return;
			}
			selectSpatialCanvasElement(selectionKey, 'preserve');
		}
		startCanvasCandidateGesture(event, selectionKey);
	}

	function nudgeSpatialCanvasSelection(
		event: KeyboardEvent,
		selectionKey: CanvasElementSelectionKey
	): boolean {
		if (
			!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey
		) {
			return false;
		}
		event.preventDefault();
		event.stopPropagation();
		if (!canvasElementSelection.keys.includes(selectionKey)) {
			selectSpatialCanvasElement(selectionKey, 'replace');
		}
		const identity = parseCanvasElementSelectionKey(selectionKey);
		const kineticWord =
			identity?.kind === 'block'
				? kineticWordDraggables.find((word) => word.id === identity.id)
				: undefined;
		if (kineticWord && canvasElementSelection.keys.length === 1) {
			const orientation = engineState.transport.orientation;
			const geometry = cloneKineticWordGeometry(
				resolveKineticWordGeometry(kineticWord, orientation)
			);
			const nativePixels = event.shiftKey ? 10 : 1;
			const deltaX =
				event.key === 'ArrowLeft'
					? -nativePixels / Math.max(1, compositionSize.width)
					: event.key === 'ArrowRight'
						? nativePixels / Math.max(1, compositionSize.width)
						: 0;
			const deltaY =
				event.key === 'ArrowUp'
					? -nativePixels / Math.max(1, compositionSize.height)
					: event.key === 'ArrowDown'
						? nativePixels / Math.max(1, compositionSize.height)
						: 0;
			const atMs = (timelineHandle.current?.time ?? 0) * 1000;
			if (atMs > 0) {
				const channels = animState.kineticWordChannels[kineticWord.id];
				void runSetCompositionKineticWordPositionKeyframeOperation({
					expectedRevision: compositionEditHistory.revision,
					wordId: kineticWord.id,
					scope: orientation,
					atMs,
					x: (channels?.x ?? 0) + deltaX,
					y: (channels?.y ?? 0) + deltaY
				});
				return true;
			}
			geometry.position.x = clampNumber(geometry.position.x + deltaX, 0, 1);
			geometry.position.y = clampNumber(geometry.position.y + deltaY, 0, 1);
			void runSetCompositionKineticWordPlacementOperation({
				expectedRevision: compositionEditHistory.revision,
				wordId: kineticWord.id,
				scope: kineticWord.orientationOverrides?.[orientation] ? orientation : 'shared',
				geometry
			});
			return true;
		}
		const selectionKeys = [...canvasElementSelection.keys];
		const elements = selectedCanvasAlignableElements(selectionKeys);
		if (elements.length !== selectionKeys.length) return true;
		const nativePixels = event.shiftKey ? 10 : 1;
		const delta = {
			x:
				event.key === 'ArrowLeft'
					? -nativePixels / Math.max(1, compositionSize.width)
					: event.key === 'ArrowRight'
						? nativePixels / Math.max(1, compositionSize.width)
						: 0,
			y:
				event.key === 'ArrowUp'
					? -nativePixels / Math.max(1, compositionSize.height)
					: event.key === 'ArrowDown'
						? nativePixels / Math.max(1, compositionSize.height)
						: 0
		};
		const change = applyCanvasAlignmentTranslations(
			engineState,
			elements,
			selectionKeys.map((key) => ({ selectionKey: key, delta }))
		);
		if (change) recordCanvasAlignmentChange('Nudge canvas elements', change);
		return true;
	}

	function onCanvasCandidateKeyDown(event: KeyboardEvent, selectionKey: string): void {
		if (
			isCanvasElementSelectionKey(selectionKey) &&
			nudgeSpatialCanvasSelection(event, selectionKey)
		) {
			return;
		}
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		lastCanvasSelectionKey = selectionKey;
		if (isCanvasElementSelectionKey(selectionKey)) {
			selectSpatialCanvasElement(selectionKey, event.shiftKey ? 'toggle' : 'replace');
			return;
		}
		selectCanvasCandidate(selectionKey);
	}

	// ─── Multi-selection alignment and distribution ───────────────────────────────

	const selectedCanvasElementCount = $derived(canvasElementSelection.keys.length);
	const canDistributeCanvasElements = $derived(selectedCanvasElementCount >= 3);

	function canvasAlignableElement(
		selectionKey: CanvasElementSelectionKey
	): CanvasAlignableElement | null {
		void measureEpoch;
		const identity = parseCanvasElementSelectionKey(selectionKey);
		const geometry = currentCanvasInteractionGeometry();
		if (!identity || !geometry) return null;
		let sourceElement: HTMLElement | null;
		if (identity.kind === 'overlay') {
			const overlay = engineState.overlays.find(({ id }) => id === identity.id);
			sourceElement = overlay ? getOverlayEl(overlay) : null;
		} else {
			sourceElement =
				compositionElement?.querySelector<HTMLElement>(
					`[data-diagram-primitive="${CSS.escape(identity.id)}"], [data-kinetic-word="${CSS.escape(identity.id)}"]`
				) ?? null;
		}
		if (!sourceElement) return null;
		const rendered = geometry.renderedBoundsFor(
			canvasInteractionRect(sourceElement.getBoundingClientRect()),
			identity.kind === 'overlay' ? 'overlay' : 'surface'
		);
		return rendered ? { selectionKey, bounds: rendered.compositionBounds.normalized } : null;
	}

	function allCanvasAlignableElements(): CanvasAlignableElement[] {
		const selectionKeys: CanvasElementSelectionKey[] = [
			...engineState.overlays.map(({ id }) => `overlay:${id}` as CanvasElementSelectionKey),
			...diagramPrimitiveDraggables.map(({ id }) => `block:${id}` as CanvasElementSelectionKey)
		];
		return selectionKeys
			.map((selectionKey) => canvasAlignableElement(selectionKey))
			.filter((element): element is CanvasAlignableElement => element !== null);
	}

	function selectedCanvasAlignableElements(
		selectionKeys: readonly CanvasElementSelectionKey[]
	): CanvasAlignableElement[] {
		const elements: CanvasAlignableElement[] = [];
		for (const selectionKey of selectionKeys) {
			const element = canvasAlignableElement(selectionKey);
			if (!element) return [];
			elements.push(element);
		}
		return elements;
	}

	function canvasAlignmentSnapshotKey(
		snapshot: CanvasAlignmentGeometrySnapshot
	): CanvasElementSelectionKey {
		return `${snapshot.kind}:${snapshot.id}`;
	}

	function recordCanvasAlignmentChange(label: string, change: CanvasAlignmentGeometryChange): void {
		compositionEditHistory.recordApplied({
			label,
			undo: () => {
				restoreCanvasAlignmentGeometry(engineState, change.before);
				measureEpoch += 1;
			},
			redo: () => {
				restoreCanvasAlignmentGeometry(engineState, change.after);
				measureEpoch += 1;
			}
		});
	}

	function settleCanvasAlignmentLayout(): Promise<void> {
		return tick().then(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				})
		);
	}

	const CANVAS_ALIGNMENT_LAYOUT_PASSES = 6;
	let canvasAlignmentCommandRunning = $state(false);

	async function executeCanvasAlignmentCommand(
		label: string,
		reference: CanvasAlignmentReference,
		resolveTranslations: (
			elements: readonly CanvasAlignableElement[],
			reference: CanvasAlignmentReference
		) => CanvasElementTranslation[]
	): Promise<void> {
		if (canvasAlignmentCommandRunning) return;
		canvasAlignmentCommandRunning = true;
		const selectionKeys = [...canvasElementSelection.keys];
		const orientation = engineState.transport.orientation;
		const before: CanvasAlignmentGeometrySnapshot[] = [];
		const after: CanvasAlignmentGeometrySnapshot[] = [];

		try {
			for (let pass = 0; pass < CANVAS_ALIGNMENT_LAYOUT_PASSES; pass += 1) {
				if (engineState.transport.orientation !== orientation) break;
				const elements = selectedCanvasAlignableElements(selectionKeys);
				const translations = resolveTranslations(elements, reference);
				const change = applyCanvasAlignmentTranslations(engineState, elements, translations);
				if (!change) break;
				for (const snapshot of change.before) {
					const selectionKey = canvasAlignmentSnapshotKey(snapshot);
					if (!before.some((entry) => canvasAlignmentSnapshotKey(entry) === selectionKey)) {
						before.push(snapshot);
					}
				}
				for (const snapshot of change.after) {
					const selectionKey = canvasAlignmentSnapshotKey(snapshot);
					const previousIndex = after.findIndex(
						(entry) => canvasAlignmentSnapshotKey(entry) === selectionKey
					);
					if (previousIndex >= 0) after[previousIndex] = snapshot;
					else after.push(snapshot);
				}
				await settleCanvasAlignmentLayout();
			}
			if (before.length > 0) {
				recordCanvasAlignmentChange(label, { before, after });
			}
		} finally {
			canvasAlignmentCommandRunning = false;
		}
	}

	function runCanvasAlignmentCommand(
		command: CanvasAlignmentCommand,
		reference: CanvasAlignmentReference
	): Promise<void> {
		return executeCanvasAlignmentCommand(
			`Align canvas elements ${command}`,
			reference,
			(elements, activeReference) =>
				resolveCanvasAlignmentTranslations(elements, command, activeReference)
		);
	}

	function runCanvasDistributionCommand(
		command: CanvasDistributionCommand,
		reference: CanvasAlignmentReference
	): Promise<void> {
		return executeCanvasAlignmentCommand(
			`Distribute canvas elements ${command}`,
			reference,
			(elements, activeReference) =>
				resolveCanvasDistributionTranslations(elements, command, activeReference)
		);
	}

	// ─── Backdrop: reframe the stage camera, pan when zoomed in, or deselect ──────
	// A press on the empty canvas starts a gesture. On a depth stage with an
	// authored camera pose, dragging at fit zoom grabs the page: the camera's aim
	// moves so the page point under the pointer stays under the pointer (the
	// orbit keeps the aim at frame centre, so the page slides, not a marker).
	// Dragging while zoomed in pans the view; release without a real drag
	// deselects (→ root inspector).

	interface PanGesture {
		startX: number;
		startY: number;
		originPanX: number;
		originPanY: number;
		moved: boolean;
		/** The page point grabbed and the aim before the drag, when reframing. */
		reframe: { grabbed: { x: number; y: number }; before: { x: number; y: number } } | null;
	}

	let panGesture: PanGesture | null = null;

	// The pose the current frame is filmed through: under a vertical frame
	// with its own camera, reframing edits the vertical pose.
	function stageCameraPose(): StageCameraPose | null {
		const stage = engineState.stage;
		if (stage?.type !== 'depth') return null;
		const vertical =
			engineState.transport.orientation === 'vertical' ? stage.camera.vertical?.pose : undefined;
		return vertical ?? stage.camera.pose ?? null;
	}

	// The same pose, authored from the rest camera when the frame has none yet —
	// a first orbit or dolly turns the pose on the way the inspector's toggle does.
	function ensureStageCameraPose(): StageCameraPose | null {
		const stage = engineState.stage;
		if (stage?.type !== 'depth') return null;
		if (engineState.transport.orientation === 'vertical' && stage.camera.vertical) {
			stage.camera.vertical.pose ??= restStageCameraPose();
			return stage.camera.vertical.pose;
		}
		stage.camera.pose ??= restStageCameraPose();
		return stage.camera.pose;
	}

	// ─── Orbit and dolly by hand (ADR-0060 §4) ────────────────────────────────────
	// At fit zoom, dragging a body orbits the camera about its aim as if the
	// object were grabbed: drag right turns the object's near side right (the
	// camera swings left), drag down tips its top toward the eye (the camera
	// rises). The wheel dollies. Both write the frame's pose through the same
	// clamped writers the Camera inspector uses and record one undo entry per
	// gesture; grabbing the page keeps reframing the aim as before.

	interface StageOrbitGesture {
		startX: number;
		startY: number;
		originYaw: number;
		originPitch: number;
		frameHeightPx: number;
		moved: boolean;
		document: Preset | null;
	}

	let orbitGesture: StageOrbitGesture | null = null;

	function startStageOrbit(event: PointerEvent): void {
		if (event.button !== 0 || zoom > 1) return;
		const pose = ensureStageCameraPose();
		const canvasRect = canvas?.getBoundingClientRect();
		if (!pose || !canvasRect || canvasRect.height <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		orbitGesture = {
			startX: event.clientX,
			startY: event.clientY,
			originYaw: pose.yaw,
			originPitch: pose.pitch,
			frameHeightPx: canvasRect.height,
			moved: false,
			document: captureCompositionGestureOrigin()
		};
		window.addEventListener('pointermove', onStageOrbitMove);
		window.addEventListener('pointerup', onStageOrbitUp);
	}

	function onStageOrbitMove(event: PointerEvent): void {
		const gesture = orbitGesture;
		if (!gesture) return;
		const dx = event.clientX - gesture.startX;
		const dy = event.clientY - gesture.startY;
		if (!gesture.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
		gesture.moved = true;
		const pose = stageCameraPose();
		if (!pose) return;
		setStageCameraPoseAngle(
			pose,
			'yaw',
			gesture.originYaw - stageOrbitDegreesForDrag(dx, gesture.frameHeightPx),
			STAGE_CAMERA_POSE_LIMITS.yawDegrees
		);
		setStageCameraPoseAngle(
			pose,
			'pitch',
			gesture.originPitch + stageOrbitDegreesForDrag(dy, gesture.frameHeightPx),
			STAGE_CAMERA_POSE_LIMITS.pitchDegrees
		);
		measureEpoch += 1;
	}

	function onStageOrbitUp(): void {
		const gesture = orbitGesture;
		orbitGesture = null;
		window.removeEventListener('pointermove', onStageOrbitMove);
		window.removeEventListener('pointerup', onStageOrbitUp);
		if (!gesture?.moved) return;
		recordCompositionGestureEdit('Orbit stage camera', gesture.document);
	}

	// A wheel is a burst of events; the dolly records once when the hand rests.
	const STAGE_DOLLY_SETTLE_MS = 300;
	let dollyOrigin: Preset | null = null;
	let dollySettleTimer: ReturnType<typeof setTimeout> | null = null;

	function settleStageDolly(): void {
		dollySettleTimer = null;
		const origin = dollyOrigin;
		dollyOrigin = null;
		if (origin) recordCompositionGestureEdit('Dolly stage camera', origin);
	}

	function onStageDollyWheel(event: WheelEvent): void {
		if (zoom > 1 || engineState.stage?.type !== 'depth') return;
		const pose = ensureStageCameraPose();
		if (!pose) return;
		event.preventDefault();
		dollyOrigin ??= captureCompositionGestureOrigin();
		setStageCameraPoseDistance(pose, stageDollyDistance(pose.distance, event.deltaY));
		measureEpoch += 1;
		if (dollySettleTimer !== null) clearTimeout(dollySettleTimer);
		dollySettleTimer = setTimeout(settleStageDolly, STAGE_DOLLY_SETTLE_MS);
	}

	// Wheel listeners must opt out of passive to keep the page from scrolling.
	const attachStageDolly: Attachment<HTMLElement> = (element) => {
		element.addEventListener('wheel', onStageDollyWheel, { passive: false });
		return () => element.removeEventListener('wheel', onStageDollyWheel);
	};

	function onBackdropDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		const pose = zoom <= 1 ? stageCameraPose() : null;
		const grabbed = pose ? pointerToComp(event.clientX, event.clientY, 'surface') : null;
		panGesture = {
			startX: event.clientX,
			startY: event.clientY,
			originPanX: panX,
			originPanY: panY,
			moved: false,
			reframe: pose && grabbed ? { grabbed, before: { ...pose.aim } } : null
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', onBackdropMove);
			window.addEventListener('pointerup', onBackdropUp);
		}
	}

	function onBackdropMove(event: PointerEvent): void {
		if (!panGesture) return;
		const dx = event.clientX - panGesture.startX;
		const dy = event.clientY - panGesture.startY;
		if (!panGesture.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
		if (!panGesture.moved && zoom > 1) onPanStart?.(); // drop the transition before panning
		panGesture.moved = true;
		if (panGesture.reframe) {
			// Each move re-projects under the aim the last move set, so the grabbed
			// page point converges under the pointer within a frame or two.
			const pose = stageCameraPose();
			const under = pointerToComp(event.clientX, event.clientY, 'surface');
			if (!pose || !under) return;
			pose.aim = {
				x: roundedCanvasScalar(pose.aim.x + (panGesture.reframe.grabbed.x - under.x), 0, 1),
				y: roundedCanvasScalar(pose.aim.y + (panGesture.reframe.grabbed.y - under.y), 0, 1)
			};
			measureEpoch += 1;
			return;
		}
		if (zoom <= 1 || !onPan) return; // nothing to pan at fit
		// Clamp so the canvas can't be dragged entirely out of view: allow panning
		// up to the zoom overflow on each side (plus a little slack).
		const rootRect = rootEl?.getBoundingClientRect();
		const canvasRect = canvas?.getBoundingClientRect();
		let nextX = panGesture.originPanX + dx;
		let nextY = panGesture.originPanY + dy;
		if (rootRect && canvasRect) {
			const maxX = Math.max(0, (canvasRect.width - rootRect.width) / 2 + 48);
			const maxY = Math.max(0, (canvasRect.height - rootRect.height) / 2 + 48);
			nextX = clampNumber(nextX, -maxX, maxX);
			nextY = clampNumber(nextY, -maxY, maxY);
		}
		onPan(nextX, nextY);
	}

	function onBackdropUp(): void {
		const gesture = panGesture;
		panGesture = null;
		if (typeof window !== 'undefined') {
			window.removeEventListener('pointermove', onBackdropMove);
			window.removeEventListener('pointerup', onBackdropUp);
		}
		if (!gesture?.moved) {
			deselectLayer();
			return;
		}
		if (!gesture.reframe) {
			if (zoom > 1) onPanEnd?.();
			return;
		}
		const pose = stageCameraPose();
		if (!pose) return;
		const before = gesture.reframe.before;
		const after = { ...pose.aim };
		if (before.x === after.x && before.y === after.y) return;
		compositionEditHistory.recordApplied({
			label: 'Reframe stage camera',
			undo: () => {
				const current = stageCameraPose();
				if (current) current.aim = { ...before };
				measureEpoch += 1;
			},
			redo: () => {
				const current = stageCameraPose();
				if (current) current.aim = { ...after };
				measureEpoch += 1;
			}
		});
	}

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		if (dollySettleTimer !== null) clearTimeout(dollySettleTimer);
		window.removeEventListener('pointermove', onStageOrbitMove);
		window.removeEventListener('pointerup', onStageOrbitUp);
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);
		window.removeEventListener('pointermove', onBlockPointerMove);
		window.removeEventListener('pointerup', onBlockPointerUp);
		window.removeEventListener('pointercancel', onBlockPointerUp);
		removeKineticWordDragListeners();
		removeTextBoxResizeListeners();
		removeScaleListeners();
		removeRotateListeners();
		window.removeEventListener('pointermove', onBackdropMove);
		window.removeEventListener('pointerup', onBackdropUp);
	});
</script>

<!-- Positioned over the canvas by Workspace; pointer-events only where overlays are -->
<div
	bind:this={rootEl}
	class="canvas-editing-overlay"
	role="presentation"
	{@attach trackCanvasGeometryChanges}
>
	<!-- Full-area backdrop: drag to pan when zoomed in, plain click to deselect -->
	<div
		class="canvas-editing-overlay__backdrop"
		class:canvas-editing-overlay__backdrop--pannable={zoom > 1}
		{@attach attachStageDolly}
		onpointerdown={onBackdropDown}
		onpointerenter={() => {
			measureEpoch += 1;
		}}
		role="presentation"
		aria-hidden="true"
	></div>
	{#if activeCanvasSnapGuides.length > 0}
		<svg class="canvas-snap-guide-layer" aria-hidden="true">
			{#each activeCanvasSnapGuides as activeGuide (activeGuide.guide.axis)}
				{@const line = canvasSnapGuideLine(activeGuide)}
				{#if line}
					<line
						class="canvas-snap-guide"
						x1={line.start.x}
						y1={line.start.y}
						x2={line.end.x}
						y2={line.end.y}
					></line>
				{/if}
			{/each}
		</svg>
	{/if}
	{#if selectedCanvasElementCount >= 2}
		<CanvasAlignmentToolbar
			selectedCount={selectedCanvasElementCount}
			canDistribute={canDistributeCanvasElements}
			busy={canvasAlignmentCommandRunning}
			onAlign={runCanvasAlignmentCommand}
			onDistribute={runCanvasDistributionCommand}
		/>
	{/if}
	{#each surfaceMessages as message, index (index)}
		{@const rect = messageRelRect(message, index)}
		{@const region = rect ? canvasHitRegion(rect) : null}
		{@const selectionKey = `message:${index}`}
		{@const selectionIdentity = { kind: 'surface-message', index } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{#if region}
			<div
				class={[
					'canvas-selection-target',
					'interior-hit',
					isTrackSelected(selectionIdentity) && 'canvas-selection-target--selected'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="surface-content"
				data-canvas-paint-index={index}
				data-canvas-stable-id={selectionKey}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Edit message ${index + 1}`}
				title={CANVAS_OVERLAP_CYCLE_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'surface-content',
					paintIndex: index,
					stableId: selectionKey
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
			</div>
		{/if}
	{/each}
	{#each surfaceItems as item, index (index)}
		{@const rect = itemRelRect(item, index)}
		{@const region = rect ? canvasHitRegion(rect) : null}
		{@const selectionKey = `item:${index}`}
		{@const selectionIdentity = { kind: 'checklist-item', index } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{#if region}
			<div
				class={[
					'canvas-selection-target',
					'interior-hit',
					isTrackSelected(selectionIdentity) && 'canvas-selection-target--selected'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="surface-content"
				data-canvas-paint-index={index}
				data-canvas-stable-id={selectionKey}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Edit item ${index + 1}`}
				title={CANVAS_OVERLAP_CYCLE_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'surface-content',
					paintIndex: index,
					stableId: selectionKey
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
			</div>
		{/if}
	{/each}
	{#each SURFACE_TEXT_SLOTS as slot, slotIndex (slot)}
		{@const rect = slotRelRect(slot)}
		{@const region = rect ? canvasHitRegion(rect) : null}
		{@const selectionKey = `slot:${slot}`}
		{@const selectionIdentity = { kind: 'surface' } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{#if region}
			<div
				class={[
					'canvas-selection-target',
					'interior-hit',
					isCanvasCandidateSelected(selectionKey, selectionIdentity) &&
						'canvas-selection-target--selected'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="surface-text"
				data-canvas-paint-index={slotIndex}
				data-canvas-stable-id={selectionKey}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Edit ${slot}`}
				title={CANVAS_OVERLAP_CYCLE_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'surface-text',
					paintIndex: slotIndex,
					stableId: selectionKey
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
			</div>
		{/if}
	{/each}
	{#each diagramPrimitiveDraggables as primitive, primitiveIndex (primitive.id)}
		{@const rect = blockRelRect(primitive)}
		{@const region = rect ? canvasHitRegion(rect) : null}
		{@const selectionKey = `block:${primitive.id}` as CanvasElementSelectionKey}
		{@const selectionIdentity = { kind: 'block', blockId: primitive.id } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{#if region}
			{@const isSelected = isCanvasElementSelected(selectionKey, selectionIdentity)}
			{@const isPrimarySelected = isPrimaryCanvasElement(selectionKey, selectionIdentity)}
			<div
				class={[
					'canvas-selection-target',
					'overlay-hit',
					'block-hit',
					isSelected && 'canvas-selection-target--selected',
					isPrimarySelected && 'canvas-selection-target--primary'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="block"
				data-canvas-paint-index={primitiveIndex}
				data-canvas-stable-id={primitive.id}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Move ${primitive.type}`}
				aria-pressed={isSelected}
				aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
				title={CANVAS_SELECTION_MODIFIER_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'block',
					paintIndex: primitiveIndex,
					stableId: primitive.id
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
				{#if isPrimarySelected && primitive.type === 'label'}
					{@const localVisibleBounds = {
						left: region.visibleBounds.left - region.pointerBounds.left,
						top: region.visibleBounds.top - region.pointerBounds.top,
						width: region.visibleBounds.width,
						height: region.visibleBounds.height
					}}
					{@const textBoxResizeHandles = CANVAS_TEXT_INLINE_RESIZE_HANDLE_DESCRIPTORS.map(
						(descriptor) => ({
							side: descriptor.position,
							geometry: createCanvasHandleGeometry(localVisibleBounds, descriptor)
						})
					)}
					{#each textBoxResizeHandles as handle (handle.side)}
						<button
							class="overlay-hit__handle"
							type="button"
							data-handle-position={handle.side}
							data-handle-purpose="inline-resize"
							aria-label="Resize label from the {handle.side} side"
							aria-keyshortcuts="ArrowLeft ArrowRight"
							onkeydown={(event) => onTextBoxResizeKeyDown(event, primitive, handle.side)}
							onpointerdown={(event) => onTextBoxResizeStart(event, primitive, handle.side)}
							style:left="{handle.geometry.pointerBounds.left}px"
							style:top="{handle.geometry.pointerBounds.top}px"
							style:width="{handle.geometry.pointerBounds.width}px"
							style:height="{handle.geometry.pointerBounds.height}px"
							style:cursor={handle.geometry.cursor}
						></button>
					{/each}
				{/if}
			</div>
		{/if}
	{/each}
	{#each kineticWordDraggables as word, wordIndex (word.id)}
		{@const rect = kineticWordRelRect(word)}
		{@const region = rect ? canvasHitRegion(rect) : null}
		{@const selectionKey = `block:${word.id}` as CanvasElementSelectionKey}
		{@const selectionIdentity = { kind: 'block', blockId: word.id } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{#if region}
			{@const isSelected = isCanvasElementSelected(selectionKey, selectionIdentity)}
			{@const isPrimarySelected = isPrimaryCanvasElement(selectionKey, selectionIdentity)}
			<div
				class={[
					'canvas-selection-target',
					'overlay-hit',
					'block-hit',
					isSelected && 'canvas-selection-target--selected',
					isPrimarySelected && 'canvas-selection-target--primary'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="block"
				data-canvas-paint-index={diagramPrimitiveDraggables.length + wordIndex}
				data-canvas-stable-id={word.id}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Move ${word.text}`}
				aria-pressed={isSelected}
				aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
				title={CANVAS_SELECTION_MODIFIER_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'block',
					paintIndex: diagramPrimitiveDraggables.length + wordIndex,
					stableId: word.id
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
			</div>
		{/if}
	{/each}
	{#each engineState.overlays as overlay, overlayIndex (overlay.id)}
		{@const rect = overlayRelRect(overlay)}
		{@const region = rect ? canvasHitRegion(rect) : null}
		{@const placement = resolveOverlayPlacement(
			overlay.position,
			engineState.transport.orientation
		)}
		{@const selectionKey = `overlay:${overlay.id}` as CanvasElementSelectionKey}
		{@const selectionIdentity = { kind: 'overlay', overlayId: overlay.id } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{#if region}
			{@const isSelected = isCanvasElementSelected(selectionKey, selectionIdentity)}
			{@const isPrimarySelected = isPrimaryCanvasElement(selectionKey, selectionIdentity)}
			<div
				class={[
					'canvas-selection-target',
					'overlay-hit',
					isSelected && 'canvas-selection-target--selected',
					isPrimarySelected && 'canvas-selection-target--primary'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="overlay"
				data-canvas-paint-index={overlayIndex}
				data-canvas-stable-id={overlay.id}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Move ${overlay.type}`}
				aria-pressed={isSelected}
				aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
				title={CANVAS_SELECTION_MODIFIER_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'overlay',
					paintIndex: overlayIndex,
					stableId: overlay.id
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
				{#if isPrimarySelected}
					{@const localVisibleBounds = {
						left: region.visibleBounds.left - region.pointerBounds.left,
						top: region.visibleBounds.top - region.pointerBounds.top,
						width: region.visibleBounds.width,
						height: region.visibleBounds.height
					}}
					{@const rotationHandle = createCanvasHandleGeometry(
						localVisibleBounds,
						CANVAS_ROTATION_HANDLE_DESCRIPTOR
					)}
					{@const scaleHandles = canvasOverlayScaleHandleDescriptors(placement.anchor).map(
						(descriptor) => createCanvasHandleGeometry(localVisibleBounds, descriptor)
					)}
					<button
						class="overlay-hit__rotate"
						type="button"
						data-handle-purpose="rotation"
						aria-label="Rotate {overlay.type}"
						aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
						onkeydown={(event) => onRotateKeyDown(event, overlay)}
						onpointerdown={(event) => onRotateStart(event, overlay)}
						style:left="{rotationHandle.pointerBounds.left}px"
						style:top="{rotationHandle.pointerBounds.top}px"
						style:width="{rotationHandle.pointerBounds.width}px"
						style:height="{rotationHandle.pointerBounds.height}px"
					></button>
					{#each scaleHandles as handle (handle.position)}
						<button
							class="overlay-hit__handle"
							type="button"
							data-handle-position={handle.position}
							data-handle-purpose="uniform-scale"
							aria-label="Scale {overlay.type}"
							aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
							onkeydown={(event) => onScaleKeyDown(event, overlay)}
							onpointerdown={(event) => onScaleStart(event, overlay)}
							style:left="{handle.pointerBounds.left}px"
							style:top="{handle.pointerBounds.top}px"
							style:width="{handle.pointerBounds.width}px"
							style:height="{handle.pointerBounds.height}px"
							style:cursor={handle.cursor}
						></button>
					{/each}
				{/if}
			</div>
		{/if}
	{/each}
	<!-- The bodies the Overlays contribute (ADR-0062): each a selectable entity
	     whose row is its Overlay's, its region the projected silhouette of its
	     mesh where the stage draws it, stacked above the screen it stands before. -->
	{#each overlayBodyHitRegions() as { overlay, index, region } (overlay.id)}
		{@const selectionKey = `overlay-body:${overlay.id}`}
		{@const selectionIdentity = { kind: 'overlay', overlayId: overlay.id } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{@const isSelected = isTrackSelected(selectionIdentity)}
		<div
			class={[
				'canvas-selection-target',
				'stage-body-hit',
				isSelected && 'canvas-selection-target--selected',
				isSelected && 'canvas-selection-target--primary'
			]}
			data-canvas-selection-key={selectionKey}
			data-canvas-selection-id={selectionId}
			data-canvas-selection-layer="stage-body"
			data-canvas-paint-index={index + 1}
			data-canvas-stable-id={overlay.id}
			{@attach attachStageDolly}
			onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
			role="button"
			tabindex="0"
			aria-label={`Select ${overlay.type}`}
			aria-pressed={isSelected}
			title={CANVAS_OVERLAP_CYCLE_HINT}
			onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
			style:left="{region.pointerBounds.left}px"
			style:top="{region.pointerBounds.top}px"
			style:width="{region.pointerBounds.width}px"
			style:height="{region.pointerBounds.height}px"
			style:z-index={canvasSelectionStackIndex({
				layer: 'stage-body',
				paintIndex: index + 1,
				stableId: overlay.id
			})}
		>
			<span
				class="canvas-selection-outline"
				aria-hidden="true"
				style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
				style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
				style:width="{region.visibleBounds.width}px"
				style:height="{region.visibleBounds.height}px"
			></span>
		</div>
	{/each}
	<!-- The stage body (ADR-0060 §3): the screen model as a selectable entity,
	     its region the projected box of its mesh, ranked below the page it
	     surrounds so the picture keeps its own press. -->
	{#if engineState.stage?.screen}
		{@const bodyId = STAGE_SCREEN_BODY_ID}
		{@const selectionKey = `stage-body:${bodyId}`}
		{@const selectionIdentity = { kind: 'stage-body', bodyId } as const}
		{@const selectionId = createTimelineTrackId(selectionIdentity)}
		{@const region = stageBodyHitRegion()}
		{#if region}
			{@const isSelected = isTrackSelected(selectionIdentity)}
			<div
				class={[
					'canvas-selection-target',
					'stage-body-hit',
					isSelected && 'canvas-selection-target--selected',
					isSelected && 'canvas-selection-target--primary'
				]}
				data-canvas-selection-key={selectionKey}
				data-canvas-selection-id={selectionId}
				data-canvas-selection-layer="stage-body"
				data-canvas-paint-index={0}
				data-canvas-stable-id={bodyId}
				{@attach attachStageDolly}
				onpointerdown={(event) => onCanvasCandidatePointerDown(event, selectionKey)}
				role="button"
				tabindex="0"
				aria-label={`Select ${getStageModel(engineState.stage.screen.model)?.label ?? 'body'}`}
				aria-pressed={isSelected}
				title={CANVAS_OVERLAP_CYCLE_HINT}
				onkeydown={(event) => onCanvasCandidateKeyDown(event, selectionKey)}
				style:left="{region.pointerBounds.left}px"
				style:top="{region.pointerBounds.top}px"
				style:width="{region.pointerBounds.width}px"
				style:height="{region.pointerBounds.height}px"
				style:z-index={canvasSelectionStackIndex({
					layer: 'stage-body',
					paintIndex: 0,
					stableId: bodyId
				})}
			>
				<span
					class="canvas-selection-outline"
					aria-hidden="true"
					style:left="{region.visibleBounds.left - region.pointerBounds.left}px"
					style:top="{region.visibleBounds.top - region.pointerBounds.top}px"
					style:width="{region.visibleBounds.width}px"
					style:height="{region.visibleBounds.height}px"
				></span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.canvas-editing-overlay {
		inset: 0;
		pointer-events: none;
		position: absolute;
	}

	.canvas-editing-overlay__backdrop {
		inset: 0;
		pointer-events: all;
		position: absolute;
	}

	/* Zoomed in → the empty canvas can be dragged to pan. */
	.canvas-editing-overlay__backdrop--pannable {
		cursor: grab;
	}

	.canvas-editing-overlay__backdrop--pannable:active {
		cursor: grabbing;
	}

	.canvas-snap-guide-layer {
		block-size: 100%;
		inline-size: 100%;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		position: absolute;
		z-index: 850000;
	}

	.canvas-snap-guide {
		shape-rendering: crispEdges;
		stroke: color-mix(in srgb, var(--chrome-text, #e8e8ea) 72%, transparent);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	/* Pointer regions may be larger than the pixels they represent. Their nested
	   outlines stay on the observed visual bounds, so forgiving selection never
	   changes editor chrome geometry or authored composition pixels. */
	.canvas-selection-target {
		outline: none;
		pointer-events: all;
		position: absolute;
	}

	.canvas-selection-outline {
		box-sizing: border-box;
		outline: none;
		outline-offset: -1px;
		pointer-events: none;
		position: absolute;
	}

	/* Draggable overlays and Blocks use a solid, restrained ring. */
	.overlay-hit {
		cursor: grab;
		touch-action: none;
	}

	.overlay-hit:active {
		cursor: grabbing;
	}

	.overlay-hit:hover > .canvas-selection-outline {
		outline: 1.5px solid rgba(255, 214, 8, 0.7);
	}

	/* Surface-interior content is selectable but not spatially draggable. */
	.interior-hit {
		cursor: pointer;
	}

	.interior-hit:hover > .canvas-selection-outline {
		outline: 1.5px dashed rgba(255, 214, 8, 0.7);
	}

	.canvas-selection-target--selected > .canvas-selection-outline,
	.canvas-selection-target--selected:hover > .canvas-selection-outline {
		outline: 1px solid #ffd608;
	}

	.canvas-selection-target--primary > .canvas-selection-outline,
	.canvas-selection-target--primary:hover > .canvas-selection-outline,
	.canvas-selection-target:focus-visible > .canvas-selection-outline {
		outline: 2px solid #ffd608;
	}

	/* Handle buttons use the contract's 24px screen-space pointer bounds. The
	   visible chrome stays fixed at 10px and therefore never bloats with zoom. */
	.overlay-hit__handle,
	.overlay-hit__rotate {
		background: transparent;
		border: 0;
		box-sizing: border-box;
		padding: 0;
		pointer-events: all;
		position: absolute;
		touch-action: none;
	}

	.overlay-hit__handle::before {
		background: #ffd608;
		block-size: 10px;
		border: 1px solid rgba(0, 0, 0, 0.5);
		border-radius: 1px;
		box-sizing: border-box;
		content: '';
		inline-size: 10px;
		inset-block-start: calc(50% - 5px);
		inset-inline-start: calc(50% - 5px);
		position: absolute;
	}

	/* Rotate lollipop — its circle and stem are visual chrome inside the larger
	   pointer target supplied by the same handle contract. */
	.overlay-hit__rotate {
		cursor: grab;
	}

	.overlay-hit__rotate::before {
		background: #ffd608;
		block-size: 9px;
		border: 1px solid rgba(0, 0, 0, 0.5);
		border-radius: 50%;
		box-sizing: border-box;
		content: '';
		inline-size: 9px;
		inset-block-start: calc(50% - 4.5px);
		inset-inline-start: calc(50% - 4.5px);
		position: absolute;
	}

	.overlay-hit__rotate::after {
		background: rgba(255, 214, 8, 0.7);
		block-size: 10px;
		content: '';
		inline-size: 1.5px;
		inset-block-start: calc(50% + 4.5px);
		inset-inline-start: calc(50% - 0.75px);
		position: absolute;
	}

	.overlay-hit__handle:focus-visible,
	.overlay-hit__rotate:focus-visible {
		outline: 1px solid #ffd608;
		outline-offset: -1px;
	}

	.overlay-hit__rotate:active {
		cursor: grabbing;
	}
</style>
