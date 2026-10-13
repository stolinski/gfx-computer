import { describe, expect, it } from 'vite-plus/test';

import {
	CANVAS_ROTATION_HANDLE_DESCRIPTOR,
	CANVAS_TEXT_INLINE_RESIZE_HANDLE_DESCRIPTORS,
	canvasOverlayScaleHandleDescriptors,
	createCanvasHandleGeometry,
	createCanvasHitRegionGeometry,
	createCanvasInteractionGeometryContract,
	orderCanvasSelectionCandidates,
	resolveCanvasSelectionCandidateAtPoint,
	type CanvasInteractionGeometryViewport,
	type CanvasInteractionRect,
	canvasSelectionStackIndex,
	compareCanvasSelectionOrder
} from './canvas-interaction-geometry';

function horizontalViewport(
	canvasBounds: CanvasInteractionRect
): CanvasInteractionGeometryViewport {
	return {
		editorBounds: { left: 20, top: 10, width: 1200, height: 700 },
		canvasBounds,
		compositionDomBounds: { left: 40, top: 30, width: 1920, height: 1080 },
		compositionSize: { width: 3840, height: 2160 },
		projector: null
	};
}

describe('canvas interaction coordinate contract', () => {
	it('projects rendered bounds through the zoomed horizontal canvas without changing composition coordinates', () => {
		const sourceBounds = { left: 520, top: 300, width: 960, height: 270 };
		const fitGeometry = createCanvasInteractionGeometryContract(
			horizontalViewport({ left: 100, top: 80, width: 960, height: 540 })
		);
		const zoomGeometry = createCanvasInteractionGeometryContract(
			horizontalViewport({ left: -380, top: -190, width: 1920, height: 1080 })
		);

		expect(fitGeometry?.renderedBoundsFor(sourceBounds, 'surface')).toEqual({
			compositionBounds: {
				normalized: { left: 0.25, top: 0.25, width: 0.5, height: 0.25 },
				native: { left: 960, top: 540, width: 1920, height: 540 }
			},
			frameBounds: { left: 0.25, top: 0.25, width: 0.5, height: 0.25 },
			screenBounds: { left: 340, top: 215, width: 480, height: 135 },
			editorBounds: { left: 320, top: 205, width: 480, height: 135 }
		});
		expect(zoomGeometry?.renderedBoundsFor(sourceBounds, 'surface')).toEqual({
			compositionBounds: {
				normalized: { left: 0.25, top: 0.25, width: 0.5, height: 0.25 },
				native: { left: 960, top: 540, width: 1920, height: 540 }
			},
			frameBounds: { left: 0.25, top: 0.25, width: 0.5, height: 0.25 },
			screenBounds: { left: 100, top: 80, width: 960, height: 270 },
			editorBounds: { left: 80, top: 70, width: 960, height: 270 }
		});
	});

	it('converts zoomed screen points to horizontal normalized and native composition coordinates', () => {
		const geometry = createCanvasInteractionGeometryContract(
			horizontalViewport({ left: -380, top: -190, width: 1920, height: 1080 })
		);

		expect(geometry?.screenPointToComposition({ x: 580, y: 350 }, 'overlay')).toEqual({
			normalized: { x: 0.5, y: 0.5 },
			native: { x: 1920, y: 1080 }
		});
		expect(geometry?.screenPointToComposition({ x: 772, y: 458 }, 'overlay')).toEqual({
			normalized: { x: 0.6, y: 0.6 },
			native: { x: 2304, y: 1296 }
		});
	});

	it('converts the same composition-width resize independently of display zoom', () => {
		const fitGeometry = createCanvasInteractionGeometryContract(
			horizontalViewport({ left: 100, top: 80, width: 960, height: 540 })
		);
		const zoomGeometry = createCanvasInteractionGeometryContract(
			horizontalViewport({ left: -380, top: -190, width: 1920, height: 1080 })
		);

		expect(
			fitGeometry?.screenDeltaToComposition({ x: 100, y: 200 }, { x: 196, y: 200 }, 'surface')
		).toEqual({ normalized: { x: 0.1, y: 0 }, native: { x: 384, y: 0 } });
		expect(
			zoomGeometry?.screenDeltaToComposition({ x: -380, y: 200 }, { x: -188, y: 200 }, 'surface')
		).toEqual({ normalized: { x: 0.1, y: 0 }, native: { x: 384, y: 0 } });
	});

	it('uses independent axes for vertical composition conversion', () => {
		const geometry = createCanvasInteractionGeometryContract({
			editorBounds: { left: 100, top: 25, width: 600, height: 700 },
			canvasBounds: { left: 200, top: 50, width: 360, height: 640 },
			compositionDomBounds: { left: 10, top: 20, width: 1080, height: 1920 },
			compositionSize: { width: 2160, height: 3840 },
			projector: null
		});

		expect(
			geometry?.renderedBoundsFor({ left: 280, top: 500, width: 540, height: 960 }, 'surface')
		).toEqual({
			compositionBounds: {
				normalized: { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
				native: { left: 540, top: 960, width: 1080, height: 1920 }
			},
			frameBounds: { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
			screenBounds: { left: 290, top: 210, width: 180, height: 320 },
			editorBounds: { left: 190, top: 185, width: 180, height: 320 }
		});
		expect(geometry?.screenPointToComposition({ x: 470, y: 210 }, 'surface')).toEqual({
			normalized: { x: 0.75, y: 0.25 },
			native: { x: 1620, y: 960 }
		});
	});

	it('rejects zero-area viewports instead of persisting invalid coordinates', () => {
		expect(
			createCanvasInteractionGeometryContract(
				horizontalViewport({ left: 0, top: 0, width: 0, height: 540 })
			)
		).toBeNull();
	});
});

describe('canvas interaction target geometry', () => {
	it('keeps visible bounds distinct from a forgiving screen-space pointer target', () => {
		const visibleBounds = { left: 96, top: 46, width: 2, height: 4 };
		const region = createCanvasHitRegionGeometry(visibleBounds, {
			paddingPx: 4,
			minimumPointerSizePx: 24
		});

		expect(region.visibleBounds).toEqual(visibleBounds);
		expect(region.visibleBounds).not.toBe(visibleBounds);
		expect(region.pointerBounds).toEqual({ left: 85, top: 36, width: 24, height: 24 });
	});

	it('derives fixed screen-space handle chrome and larger pointer bounds', () => {
		const scaleHandle = createCanvasHandleGeometry(
			{ left: 0, top: 0, width: 100, height: 40 },
			canvasOverlayScaleHandleDescriptors('center')[3]
		);
		const rotationHandle = createCanvasHandleGeometry(
			{ left: 0, top: 0, width: 100, height: 40 },
			CANVAS_ROTATION_HANDLE_DESCRIPTOR
		);

		expect(scaleHandle).toMatchObject({
			position: 'south-east',
			purpose: 'uniform-scale',
			visualBounds: { left: 95, top: 35, width: 10, height: 10 },
			pointerBounds: { left: 88, top: 28, width: 24, height: 24 }
		});
		expect(rotationHandle).toMatchObject({
			position: 'north',
			purpose: 'rotation',
			visualBounds: { left: 45.5, top: -22.5, width: 9, height: 9 },
			pointerBounds: { left: 38, top: -30, width: 24, height: 24 }
		});
		expect(canvasOverlayScaleHandleDescriptors('top-left').map(({ position }) => position)).toEqual(
			['north-east', 'south-west', 'south-east']
		);
		expect(
			CANVAS_TEXT_INLINE_RESIZE_HANDLE_DESCRIPTORS.map((descriptor) =>
				createCanvasHandleGeometry({ left: 0, top: 0, width: 100, height: 40 }, descriptor)
			).map(({ position, purpose, center }) => ({ position, purpose, center }))
		).toEqual([
			{ position: 'west', purpose: 'inline-resize', center: { x: 0, y: 20 } },
			{ position: 'east', purpose: 'inline-resize', center: { x: 100, y: 20 } }
		]);
	});

	it('orders overlapping selection candidates by layer, paint order, then stable identity', () => {
		const candidates = [
			{ name: 'surface', selectionOrder: { layer: 'surface-text', paintIndex: 0, stableId: 'z' } },
			{ name: 'first overlay', selectionOrder: { layer: 'overlay', paintIndex: 0, stableId: 'b' } },
			{ name: 'later overlay', selectionOrder: { layer: 'overlay', paintIndex: 1, stableId: 'a' } },
			{ name: 'block b', selectionOrder: { layer: 'block', paintIndex: 0, stableId: 'b' } },
			{ name: 'block a', selectionOrder: { layer: 'block', paintIndex: 0, stableId: 'a' } }
		] as const;

		expect(orderCanvasSelectionCandidates(candidates).map(({ name }) => name)).toEqual([
			'later overlay',
			'first overlay',
			'block a',
			'block b',
			'surface'
		]);
	});

	it('resolves drag initiation from padded bounds outside thin visible geometry', () => {
		const region = createCanvasHitRegionGeometry(
			{ left: 100, top: 50, width: 1, height: 40 },
			{ paddingPx: 4, minimumPointerSizePx: 24 }
		);
		const thinCandidate = {
			selectionKey: 'overlay:thin-rule',
			selectionOrder: { layer: 'overlay' as const, paintIndex: 0, stableId: 'thin-rule' },
			pointerBounds: region.pointerBounds
		};

		expect(resolveCanvasSelectionCandidateAtPoint([thinCandidate], { x: 90, y: 70 })).toBe(
			thinCandidate
		);
		expect(resolveCanvasSelectionCandidateAtPoint([thinCandidate], { x: 80, y: 70 })).toBeNull();
	});

	it('hit tests transparent content from layout bounds instead of painted opacity', () => {
		const transparentCandidate = {
			selectionKey: 'overlay:transparent-panel',
			selectionOrder: {
				layer: 'overlay' as const,
				paintIndex: 0,
				stableId: 'transparent-panel'
			},
			pointerBounds: { left: 20, top: 20, width: 80, height: 30 },
			paintedOpacity: 0
		};

		expect(resolveCanvasSelectionCandidateAtPoint([transparentCandidate], { x: 40, y: 30 })).toBe(
			transparentCandidate
		);
	});

	it('resolves overlaps topmost-first and cycles from the previous canvas choice', () => {
		const pointerBounds = { left: 10, top: 10, width: 40, height: 40 };
		const candidates = [
			{
				selectionKey: 'block:caption',
				selectionOrder: { layer: 'block' as const, paintIndex: 2, stableId: 'caption' },
				pointerBounds
			},
			{
				selectionKey: 'overlay:badge',
				selectionOrder: { layer: 'overlay' as const, paintIndex: 0, stableId: 'badge' },
				pointerBounds
			},
			{
				selectionKey: 'overlay:title',
				selectionOrder: { layer: 'overlay' as const, paintIndex: 1, stableId: 'title' },
				pointerBounds
			}
		];
		const point = { x: 25, y: 25 };

		expect(resolveCanvasSelectionCandidateAtPoint(candidates, point)?.selectionKey).toBe(
			'overlay:title'
		);
		expect(
			resolveCanvasSelectionCandidateAtPoint(candidates, point, {
				currentSelectionKey: 'overlay:title',
				cycle: true
			})?.selectionKey
		).toBe('overlay:badge');
		expect(
			resolveCanvasSelectionCandidateAtPoint(candidates, point, {
				currentSelectionKey: 'overlay:badge'
			})?.selectionKey
		).toBe('overlay:badge');
		expect(
			resolveCanvasSelectionCandidateAtPoint(candidates, point, {
				currentSelectionKey: 'block:caption',
				cycle: true
			})?.selectionKey
		).toBe('overlay:title');
	});
});

describe('stage body selection layer (ADR-0060 §3)', () => {
	it('ranks a stage body below the page it surrounds, so the picture wins a shared press', () => {
		const body = { layer: 'stage-body' as const, paintIndex: 9, stableId: 'screen' };
		const page = { layer: 'surface-content' as const, paintIndex: 0, stableId: 'page' };
		expect(compareCanvasSelectionOrder(page, body)).toBeLessThan(0);
		expect(canvasSelectionStackIndex(body)).toBeLessThan(canvasSelectionStackIndex(page));
	});
});
