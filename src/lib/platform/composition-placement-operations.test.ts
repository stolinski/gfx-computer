import { beforeEach, describe, expect, it } from 'vitest';

import blankPresetJson from '$lib/presets/blank.json';

import { compositionMeta } from './composition-meta.svelte';
import { runAddCompositionDiagramPrimitiveOperation } from './composition-block-layer-operations';
import { runAddCompositionOverlayOperation } from './composition-layer-operations';
import {
	runClearCompositionOrientationOverrideOperation,
	runSetCompositionDiagramGeometryOperation,
	runSetCompositionOverlayDepthOperation,
	runSetCompositionOverlayPlacementOperation,
	runSetCompositionOverlayPoseOperation,
	runSetCompositionSurfacePageAnchorOperation
} from './composition-placement-operations';
import { engineState, transitionState } from './engine-state.svelte';
import { resolveOverlayPlacement } from '$lib/utils/overlay-placement';
import { resolveDiagramPrimitiveGeometry } from '$lib/utils/diagram-geometry';
import { applyPreset } from './preset';
import { parsePresetIngress } from './preset-ingress';

import type { CompositionOperationOutcome } from './composition-edit-transaction';
import type { CompositionOperationFailure } from './composition-operation-preflight';

function expectApplied(outcome: CompositionOperationOutcome): readonly string[] {
	if (outcome.status !== 'applied') {
		throw new Error(`Expected an applied receipt but got ${outcome.code}: ${outcome.message}`);
	}
	return outcome.changed.pointers;
}

function expectFailed(outcome: CompositionOperationOutcome): CompositionOperationFailure {
	if (outcome.status !== 'failed') {
		throw new Error('Expected a failed outcome but the placement edit applied.');
	}
	return outcome;
}

async function addOverlay(expectedRevision: number): Promise<void> {
	expectApplied(
		await runAddCompositionOverlayOperation({ expectedRevision, overlayType: 'lower-third' })
	);
}

beforeEach(() => {
	transitionState.capturing = false;
	applyPreset(parsePresetIngress(blankPresetJson));
	compositionMeta.isUserComposition = true;
	compositionMeta.userCompositionSlug = 'untitled';
	compositionMeta.forkedFrom = null;
});

describe('Overlay placement', () => {
	it('writes the shared placement both orientations fall back to', async () => {
		await addOverlay(0);

		expectApplied(
			await runSetCompositionOverlayPlacementOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				target: 'shared',
				placement: { anchor: 'top-right', offset: { x: 0.08, y: 0.1 }, scale: 1.2 }
			})
		);

		expect(resolveOverlayPlacement(engineState.overlays[0].position, 'vertical')).toMatchObject({
			anchor: 'top-right',
			scale: 1.2
		});
	});

	it('writes one orientation snapshot without moving the other', async () => {
		await addOverlay(0);
		expectApplied(
			await runSetCompositionOverlayPlacementOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				target: 'shared',
				placement: { anchor: 'bottom-left', offset: { x: 0.06, y: 0.08 } }
			})
		);

		expectApplied(
			await runSetCompositionOverlayPlacementOperation({
				expectedRevision: 2,
				overlayId: 'lower-third-1',
				target: 'vertical',
				placement: { anchor: 'bottom-center', offset: { x: 0.5, y: 0.2 } }
			})
		);

		const position = engineState.overlays[0].position;
		expect(resolveOverlayPlacement(position, 'vertical').anchor).toBe('bottom-center');
		expect(resolveOverlayPlacement(position, 'horizontal').anchor).toBe('bottom-left');
	});

	it('returns an orientation to the shared placement when its snapshot is cleared', async () => {
		await addOverlay(0);
		expectApplied(
			await runSetCompositionOverlayPlacementOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				target: 'vertical',
				placement: { anchor: 'center' }
			})
		);

		expectApplied(
			await runClearCompositionOrientationOverrideOperation({
				expectedRevision: 2,
				overlayId: 'lower-third-1',
				orientation: 'vertical'
			})
		);

		expect(engineState.overlays[0].position.orientationOverrides).toBeUndefined();
	});

	it('refuses clearing a snapshot the Overlay never had', async () => {
		await addOverlay(0);

		const failure = expectFailed(
			await runClearCompositionOrientationOverrideOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				orientation: 'horizontal'
			})
		);

		expect(failure.code).toBe('precondition_unmet');
	});

	it('refuses a placement target that is neither shared nor an orientation', async () => {
		await addOverlay(0);

		const failure = expectFailed(
			await runSetCompositionOverlayPlacementOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				target: 'square' as 'shared',
				placement: { anchor: 'center' }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['shared', 'horizontal', 'vertical']);
	});

	it('sets and clears the focal distance', async () => {
		await addOverlay(0);

		expectApplied(
			await runSetCompositionOverlayDepthOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				z: 0.35
			})
		);
		expect(engineState.overlays[0].z).toBe(0.35);

		expectApplied(
			await runSetCompositionOverlayDepthOperation({
				expectedRevision: 2,
				overlayId: 'lower-third-1',
				z: null
			})
		);
		expect(engineState.overlays[0].z).toBeUndefined();
	});

	it('refuses a focal distance outside the focal range', async () => {
		await addOverlay(0);

		const failure = expectFailed(
			await runSetCompositionOverlayDepthOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				z: 4
			})
		);

		expect(failure.code).toBe('invalid_argument');
	});

	it('lifts an Overlay toward the camera with a negative depth', async () => {
		await addOverlay(0);
		expectApplied(
			await runSetCompositionOverlayDepthOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				z: -0.18
			})
		);
		expect(engineState.overlays[0].z).toBe(-0.18);
	});

	it('poses and un-poses an Overlay within the authored angle limits', async () => {
		await addOverlay(0);
		expectApplied(
			await runSetCompositionOverlayPoseOperation({
				expectedRevision: 1,
				overlayId: 'lower-third-1',
				pose: { yaw: 10, pitch: -3 }
			})
		);
		expect(engineState.overlays[0].pose).toEqual({ yaw: 10, pitch: -3, roll: 0 });

		const failure = expectFailed(
			await runSetCompositionOverlayPoseOperation({
				expectedRevision: 2,
				overlayId: 'lower-third-1',
				pose: { yaw: 90 }
			})
		);
		expect(failure.code).toBe('invalid_argument');

		expectApplied(
			await runSetCompositionOverlayPoseOperation({
				expectedRevision: 2,
				overlayId: 'lower-third-1',
				pose: null
			})
		);
		expect(engineState.overlays[0].pose).toBeUndefined();
	});
});

describe('Surface page anchor', () => {
	it('refuses a Surface without a captured page', async () => {
		const failure = expectFailed(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 0,
				pageAnchor: { x: 0.6, y: 0.5 }
			})
		);
		expect(failure.code).toBe('precondition_unmet');
	});

	it('anchors and un-anchors the filmed page', async () => {
		engineState.surface.type = 'website-screenshot';
		engineState.surface.variant = 'filmed';
		engineState.surface.content.captureAsset = 'syntax-youtube-videos';
		engineState.surface.content.sourceUrl = 'https://www.youtube.com/@syntaxfm/videos';
		expectApplied(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 0,
				pageAnchor: { x: 0.6, y: 0.5 }
			})
		);
		expect(engineState.surface.pageAnchor).toEqual({ x: 0.6, y: 0.5 });

		const failure = expectFailed(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 1,
				pageAnchor: { x: 1.4, y: 0.5 }
			})
		);
		expect(failure.code).toBe('invalid_argument');

		expectApplied(
			await runSetCompositionSurfacePageAnchorOperation({ expectedRevision: 1, pageAnchor: null })
		);
		expect(engineState.surface.pageAnchor).toBeUndefined();
	});

	it('anchors the page per orientation and returns an orientation to the shared point', async () => {
		engineState.surface.type = 'website-screenshot';
		engineState.surface.variant = 'filmed';
		engineState.surface.content.captureAsset = 'syntax-youtube-videos';
		engineState.surface.content.sourceUrl = 'https://www.youtube.com/@syntaxfm/videos';
		expectApplied(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 0,
				pageAnchor: { x: 0.54, y: 0.5 }
			})
		);
		const changed = expectApplied(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 1,
				target: 'vertical',
				pageAnchor: { x: 0.3, y: 0.2 }
			})
		);
		expect(changed).toEqual(['/state/surface/pageAnchorOrientationOverrides']);
		expect(engineState.surface.pageAnchor).toEqual({ x: 0.54, y: 0.5 });
		expect(engineState.surface.pageAnchorOrientationOverrides).toEqual({
			vertical: { x: 0.3, y: 0.2 }
		});

		const unknown = expectFailed(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 2,
				target: 'square' as 'shared',
				pageAnchor: { x: 0.3, y: 0.2 }
			})
		);
		expect(unknown.alternatives).toEqual(['shared', 'horizontal', 'vertical']);

		expectApplied(
			await runSetCompositionSurfacePageAnchorOperation({
				expectedRevision: 2,
				target: 'vertical',
				pageAnchor: null
			})
		);
		expect(engineState.surface.pageAnchorOrientationOverrides).toBeUndefined();
		expect(engineState.surface.pageAnchor).toEqual({ x: 0.54, y: 0.5 });
	});
});

describe('diagram geometry', () => {
	beforeEach(async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 0,
				primitiveType: 'node'
			})
		);
	});

	it("writes a node's shared position", async () => {
		const changed = expectApplied(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				target: 'shared',
				geometry: { position: { x: 0.2, y: 0.8 }, scale: 1.5 }
			})
		);

		expect(changed).toContain('/state/surface/diagram/0/position/x');
		expect(engineState.surface.diagram?.[0]).toMatchObject({ scale: 1.5 });
	});

	it('completes an orientation snapshot from the geometry that orientation resolves to', async () => {
		expectApplied(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				target: 'shared',
				geometry: { position: { x: 0.2, y: 0.8 }, scale: 1.5 }
			})
		);

		expectApplied(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 2,
				blockId: 'node-1',
				target: 'vertical',
				geometry: { position: { x: 0.5, y: 0.35 } }
			})
		);

		const primitive = engineState.surface.diagram?.[0];
		if (primitive?.type !== 'node') throw new Error('Expected the node primitive.');
		expect(resolveDiagramPrimitiveGeometry(primitive, 'vertical')).toMatchObject({
			position: { x: 0.5, y: 0.35 },
			scale: 1.5
		});
		expect(resolveDiagramPrimitiveGeometry(primitive, 'horizontal').position.x).toBe(0.2);
	});

	it('refuses a geometry field the primitive type does not carry', async () => {
		const failure = expectFailed(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				target: 'shared',
				geometry: { control: { x: 0.5, y: 0.5 } }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.rejected).toBe('control');
		expect(failure.alternatives).toEqual(['position', 'scale']);
	});

	it("carries an edge's authored route into the snapshot it does not own", async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'edge-arrow'
			})
		);

		expectApplied(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 2,
				blockId: 'edge-arrow-1',
				target: 'horizontal',
				geometry: { to: { x: 0.9, y: 0.5 } }
			})
		);

		const edge = engineState.surface.diagram?.[1];
		if (edge?.type !== 'edge-arrow') throw new Error('Expected the edge primitive.');
		expect(edge.orientationOverrides?.horizontal).toMatchObject({
			to: { x: 0.9, y: 0.5 },
			route: 'straight'
		});
	});

	it("writes a stat callout's counted range, which sits at the geometry pointer", async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'stat-callout'
			})
		);

		expectApplied(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 2,
				blockId: 'stat-callout-1',
				target: 'shared',
				geometry: { from: 0, to: 4200 }
			})
		);

		expect(engineState.surface.diagram?.[1]).toMatchObject({ from: 0, to: 4200 });
	});

	it("refuses a counted range in a stat callout's orientation snapshot", async () => {
		expectApplied(
			await runAddCompositionDiagramPrimitiveOperation({
				expectedRevision: 1,
				primitiveType: 'stat-callout'
			})
		);

		const failure = expectFailed(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 2,
				blockId: 'stat-callout-1',
				target: 'vertical',
				geometry: { to: 4200 }
			})
		);

		expect(failure.code).toBe('invalid_argument');
		expect(failure.alternatives).toEqual(['position', 'scale']);
	});

	it('refuses an empty geometry edit', async () => {
		const failure = expectFailed(
			await runSetCompositionDiagramGeometryOperation({
				expectedRevision: 1,
				blockId: 'node-1',
				target: 'shared',
				geometry: {}
			})
		);

		expect(failure.code).toBe('invalid_argument');
	});
});
