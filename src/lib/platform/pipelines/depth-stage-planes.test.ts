import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import { vec4 } from 'wgpu-matrix';

import {
	createStageCameraRig,
	STAGE_BACKDROP_DEPTH,
	STAGE_CAM_Z,
	stagePlaneHalfExtents
} from './depth-stage-camera';
import {
	assertStagePlaneCeilings,
	createBackdropStagePlaneBasis,
	createFrontalStagePlaneBasis,
	createPosedOverlayPlaneBasis,
	createStageProjector,
	partitionStageOverlays,
	posedOverlayStagePlane,
	selectStagePlaneCasters,
	STAGE_LIFT_DEPTH,
	sortStagePlanesBackToFront,
	STAGE_PLANE_CEILINGS,
	StagePlaneCeilingError,
	stagePlaneAxialDistance,
	stagePlaneHalfLengths,
	stagePlaneModelMatrix,
	stagePlaneTextureBytes,
	stageOverlayPlaneDepth,
	type StagePlaneBasis
} from './depth-stage-planes';

const ASPECT = 16 / 9;
const EYE: [number, number, number] = [0, 0, STAGE_CAM_Z];
const FORWARD: [number, number, number] = [0, 0, -1];
// The shipped key light travels mostly into the scene (upper-left key).
const LIGHT: [number, number, number] = [0.14, -0.16, -0.977];

describe('frontal stage plane bases', () => {
	it('fills the frame at its own distance and faces the camera', () => {
		const surface = createFrontalStagePlaneBasis(ASPECT, 0);
		const { halfW, halfH } = stagePlaneHalfExtents(STAGE_CAM_Z, ASPECT);
		assert.deepEqual(surface, {
			origin: [0, 0, -0],
			u: [halfW, 0, 0],
			v: [0, halfH, 0],
			normal: [0, 0, 1]
		});
		assert.deepEqual(stagePlaneHalfLengths(surface), { halfW, halfH });
	});

	it('oversizes the backdrop by the cover and sits it behind the Surface', () => {
		const backdrop = createBackdropStagePlaneBasis(ASPECT, 1.2);
		const fill = stagePlaneHalfExtents(STAGE_CAM_Z + STAGE_BACKDROP_DEPTH, ASPECT);
		assert.equal(backdrop.origin[2], -STAGE_BACKDROP_DEPTH);
		assert.equal(backdrop.u[0], fill.halfW * 1.2);
		assert.equal(backdrop.v[1], fill.halfH * 1.2);
	});

	it('builds the same model matrix the shipped translate-then-scale produced', () => {
		const backdrop = createBackdropStagePlaneBasis(ASPECT, 1.2);
		const matrix = stagePlaneModelMatrix(backdrop);
		assert.equal(matrix[0], Math.fround(backdrop.u[0]));
		assert.equal(matrix[5], Math.fround(backdrop.v[1]));
		assert.equal(matrix[10], 1);
		assert.equal(matrix[14], Math.fround(-STAGE_BACKDROP_DEPTH));
		assert.equal(matrix[15], 1);
	});
});

describe('plane ordering and casters', () => {
	const backdrop = { id: 'backdrop', basis: createBackdropStagePlaneBasis(ASPECT, 1.2) };
	const surface = { id: 'surface', basis: createFrontalStagePlaneBasis(ASPECT, 0) };
	const overlayBehind = {
		id: 'overlay',
		basis: createFrontalStagePlaneBasis(ASPECT, stageOverlayPlaneDepth(0.45))
	};
	const overlayAtSurface = { id: 'overlay', basis: createFrontalStagePlaneBasis(ASPECT, 0) };

	it('sorts back to front and keeps Layer order at equal depth', () => {
		const behind = sortStagePlanesBackToFront([backdrop, surface, overlayBehind], EYE, FORWARD);
		assert.deepEqual(
			behind.map((plane) => plane.id),
			['backdrop', 'overlay', 'surface']
		);
		const level = sortStagePlanesBackToFront([backdrop, surface, overlayAtSurface], EYE, FORWARD);
		assert.deepEqual(
			level.map((plane) => plane.id),
			['backdrop', 'surface', 'overlay']
		);
		assert.ok(stagePlaneAxialDistance(backdrop.basis, EYE, FORWARD) > STAGE_CAM_Z);
	});

	it('selects upstream planes as casters, nearest first, and never the receiver', () => {
		const ontoBackdrop = selectStagePlaneCasters(
			backdrop.basis,
			[backdrop, surface, overlayBehind],
			LIGHT
		);
		assert.deepEqual(
			ontoBackdrop.map((plane) => plane.id),
			['overlay', 'surface']
		);
		const ontoOverlay = selectStagePlaneCasters(
			overlayBehind.basis,
			[backdrop, surface, overlayBehind],
			LIGHT
		);
		assert.deepEqual(
			ontoOverlay.map((plane) => plane.id),
			['surface']
		);
		assert.deepEqual(
			selectStagePlaneCasters(surface.basis, [backdrop, surface, overlayAtSurface], LIGHT),
			[]
		);
	});

	it('caps casters at the ceiling', () => {
		const receiver = createBackdropStagePlaneBasis(ASPECT, 1.2);
		const many = Array.from({ length: 6 }, (_, index) => ({
			basis: createFrontalStagePlaneBasis(ASPECT, index * 0.2)
		}));
		assert.equal(
			selectStagePlaneCasters(receiver, many, LIGHT).length,
			STAGE_PLANE_CEILINGS.maxCasters
		);
	});
});

describe('stage plane ceilings', () => {
	it('accepts the shipped three-plane frame', () => {
		assertStagePlaneCeilings({
			planeCount: 3,
			posedOverlayPlaneCount: 0,
			mippedPlaneCount: 0,
			textureBytes: stagePlaneTextureBytes(3840, 2160, 8, true) * 2,
			mipPasses: 12
		});
	});

	it('fails correctively on the first exceeded ceiling', () => {
		assert.throws(
			() =>
				assertStagePlaneCeilings({
					planeCount: STAGE_PLANE_CEILINGS.maxPlanes + 1,
					posedOverlayPlaneCount: 0,
					mippedPlaneCount: 0,
					textureBytes: 0,
					mipPasses: 0
				}),
			(error: unknown) => error instanceof StagePlaneCeilingError && error.ceiling === 'maxPlanes'
		);
		assert.throws(
			() =>
				assertStagePlaneCeilings({
					planeCount: 3,
					posedOverlayPlaneCount: 0,
					mippedPlaneCount: 3,
					textureBytes: STAGE_PLANE_CEILINGS.maxPlaneTextureBytes + 1,
					mipPasses: 0
				}),
			(error: unknown) =>
				error instanceof StagePlaneCeilingError && error.ceiling === 'maxPlaneTextureBytes'
		);
	});

	it('counts a mip chain as a third more', () => {
		assert.equal(stagePlaneTextureBytes(100, 100, 8, false), 80_000);
		assert.equal(stagePlaneTextureBytes(100, 100, 8, true), Math.ceil(80_000 * (4 / 3)));
	});
});

describe('posed Overlay planes (ADR-0057)', () => {
	const overlay = (id: string, extra: Record<string, unknown> = {}) =>
		({
			type: 'lower-third',
			id,
			content: {},
			position: { anchor: 'bottom-left' },
			...extra
		}) as never;

	it('assigns Overlays with a pose or an explicit depth to their own plane, and body Overlays to the stage (ADR-0062)', () => {
		const { shared, posed, bodies } = partitionStageOverlays([
			overlay('plain'),
			overlay('deep', { z: 0.45 }),
			overlay('turned', { pose: { yaw: 10, pitch: 0, roll: 0 } }),
			overlay('lifted', { z: -0.2 }),
			overlay('headline', { type: 'dimensional-type', pose: { yaw: 10, pitch: 0, roll: 0 } })
		]);
		assert.deepEqual(
			shared.map((entry: { id: string }) => entry.id),
			['plain']
		);
		assert.deepEqual(
			posed.map((entry: { id: string }) => entry.id),
			['deep', 'turned', 'lifted']
		);
		assert.deepEqual(
			bodies.map((entry: { id: string }) => entry.id),
			['headline']
		);
	});

	it('maps signed depth to world units behind or in front of the Surface', () => {
		assert.equal(stageOverlayPlaneDepth(0.5), 0.5 * STAGE_BACKDROP_DEPTH);
		assert.equal(stageOverlayPlaneDepth(-1), -STAGE_LIFT_DEPTH);
		assert.equal(stageOverlayPlaneDepth(0), 0);
	});

	const restCamera = { move: 'static', amount: 0.5, ease: 'smooth' } as never;
	const restRig = createStageCameraRig({ aspect: ASPECT, camera: restCamera, time: 0 });

	function assertBasisClose(actual: StagePlaneBasis, expected: StagePlaneBasis): void {
		for (const key of ['origin', 'u', 'v', 'normal'] as const) {
			for (const axis of [0, 1, 2]) {
				assert.ok(
					Math.abs(actual[key][axis] - expected[key][axis]) < 1e-12,
					`${key}[${axis}] ${actual[key][axis]} ≈ ${expected[key][axis]}`
				);
			}
		}
	}

	it('is the frontal plane at a zero pose under the shipped frontal camera', () => {
		const pivot = { x: 0.3, y: 0.8 };
		assertBasisClose(
			createPosedOverlayPlaneBasis({
				rig: restRig,
				aspect: ASPECT,
				overlayZ: -0.18,
				pose: { yaw: 0, pitch: 0, roll: 0 },
				pivot
			}),
			createFrontalStagePlaneBasis(ASPECT, stageOverlayPlaneDepth(-0.18))
		);
		assertBasisClose(
			createPosedOverlayPlaneBasis({
				rig: restRig,
				aspect: ASPECT,
				overlayZ: 0.45,
				pose: undefined,
				pivot
			}),
			createFrontalStagePlaneBasis(ASPECT, stageOverlayPlaneDepth(0.45))
		);
	});

	it('places the Overlay in the camera frame under a pose: the pivot projects to its frame point at its authored size', () => {
		const camera = {
			move: 'static',
			amount: 0.5,
			ease: 'smooth',
			pose: { yaw: -20, pitch: 6, roll: 0, distance: 0.5, aim: { x: 0.72, y: 0.4 } }
		} as never;
		const rig = createStageCameraRig({ aspect: ASPECT, camera, time: 0 });
		const pivot = { x: 0.2, y: 0.85 };
		const basis = createPosedOverlayPlaneBasis({
			rig,
			aspect: ASPECT,
			overlayZ: -0.18,
			pose: undefined,
			pivot
		});
		const pivotWorld = [0, 1, 2].map(
			(axis) =>
				basis.origin[axis] + (2 * pivot.x - 1) * basis.u[axis] + (1 - 2 * pivot.y) * basis.v[axis]
		);
		const clip = vec4.transformMat4([...pivotWorld, 1], rig.viewProjection);
		assert.ok(Math.abs((clip[0] / clip[3] + 1) / 2 - pivot.x) < 1e-6, 'lands at its frame x');
		assert.ok(Math.abs((1 - clip[1] / clip[3]) / 2 - pivot.y) < 1e-6, 'lands at its frame y');
		// Page-parallel, lifted toward the camera by its depth, sized to subtend
		// the frame at the pivot's axial distance.
		assert.deepEqual(basis.normal, [0, 0, 1]);
		assert.ok(Math.abs(pivotWorld[2] - STAGE_LIFT_DEPTH * 0.18) < 1e-12);
		const axial = stagePlaneAxialDistance(
			{ ...basis, origin: pivotWorld as [number, number, number] },
			rig.eye,
			rig.forward
		);
		const fill = stagePlaneHalfExtents(axial, ASPECT);
		assert.ok(Math.abs(stagePlaneHalfLengths(basis).halfW - fill.halfW) < 1e-9);
		assert.ok(axial < STAGE_CAM_Z, 'the close camera makes the quad smaller in world units');
	});

	it('stays the world-fixed frontal plane through a legacy push or drift, so shipped Presets keep their parallax', () => {
		for (const move of ['push', 'drift'] as const) {
			const camera = { move, amount: 0.6, ease: 'smooth' } as never;
			for (const time of [0, 0.35, 0.5, 1]) {
				const rig = createStageCameraRig({ aspect: ASPECT, camera, time });
				assertBasisClose(
					createPosedOverlayPlaneBasis({
						rig,
						aspect: ASPECT,
						overlayZ: 0.45,
						pose: undefined,
						pivot: { x: 0.2, y: 0.85 }
					}),
					createFrontalStagePlaneBasis(ASPECT, stageOverlayPlaneDepth(0.45))
				);
			}
		}
	});

	it('is carried by the pose and travel only: a legacy move on top leaves the plane where the posed camera put it', () => {
		const pose = { yaw: -20, pitch: 6, roll: 0, distance: 0.5, aim: { x: 0.72, y: 0.4 } };
		const posedOnly = createStageCameraRig({
			aspect: ASPECT,
			camera: { move: 'static', amount: 0.5, ease: 'smooth', pose } as never,
			time: 0.5
		});
		const posedAndPushed = createStageCameraRig({
			aspect: ASPECT,
			camera: { move: 'push', amount: 0.6, ease: 'smooth', pose } as never,
			time: 0.5
		});
		assert.notDeepEqual(posedAndPushed.eye, posedOnly.eye, 'the push moved the eye');
		const plane = (rig: typeof posedOnly) =>
			createPosedOverlayPlaneBasis({
				rig,
				aspect: ASPECT,
				overlayZ: -0.18,
				pose: { yaw: 10, pitch: -3, roll: 0 },
				pivot: { x: 0.2, y: 0.85 }
			});
		assertBasisClose(plane(posedAndPushed), plane(posedOnly));
	});

	it('falls back to the world-fixed frontal plane when the ray through the pivot never reaches it', () => {
		const camera = {
			move: 'static',
			amount: 0.5,
			ease: 'smooth',
			pose: { yaw: 60, pitch: 45, roll: 0, distance: 1, aim: { x: 0.5, y: 0.5 } }
		} as never;
		const rig = createStageCameraRig({ aspect: ASPECT, camera, time: 0 });
		assertBasisClose(
			createPosedOverlayPlaneBasis({
				rig,
				aspect: ASPECT,
				overlayZ: -0.18,
				pose: undefined,
				pivot: { x: 0, y: 1 }
			}),
			createFrontalStagePlaneBasis(ASPECT, stageOverlayPlaneDepth(-0.18))
		);
	});

	it('turns the plane about its pivot: the pivot stays put, the right edge recedes under yaw', () => {
		const pivot = { x: 0.25, y: 0.75 };
		const frontal = createFrontalStagePlaneBasis(ASPECT, stageOverlayPlaneDepth(-0.18));
		const posed = createPosedOverlayPlaneBasis({
			rig: restRig,
			aspect: ASPECT,
			overlayZ: -0.18,
			pose: { yaw: 30, pitch: 0, roll: 0 },
			pivot
		});
		const { halfW, halfH } = stagePlaneHalfLengths(frontal);
		const pivotWorld = [(2 * pivot.x - 1) * halfW, (1 - 2 * pivot.y) * halfH, frontal.origin[2]];
		// The pivot's local coordinates on the frontal quad.
		const lu = (pivotWorld[0] - frontal.origin[0]) / halfW;
		const lv = (pivotWorld[1] - frontal.origin[1]) / halfH;
		const posedPivot = [0, 1, 2].map(
			(axis) => posed.origin[axis] + lu * posed.u[axis] + lv * posed.v[axis]
		);
		for (const axis of [0, 1, 2]) {
			assert.ok(Math.abs(posedPivot[axis] - pivotWorld[axis]) < 1e-9, `pivot axis ${axis}`);
		}
		assert.ok(posed.u[2] < 0, 'the right edge moves away from the camera');
		assert.ok(Math.abs(stagePlaneHalfLengths(posed).halfW - halfW) < 1e-9, 'extent preserved');
		assert.ok(
			Math.abs(posed.normal[0]) > 0 && posed.normal[2] > 0,
			'normal still faces the camera'
		);
	});

	it('projects and ray-casts a posed plane consistently and falls back for an unknown id', () => {
		const camera = { move: 'static', amount: 0.5, ease: 'smooth' } as never;
		const projector = createStageProjector({
			aspect: ASPECT,
			camera,
			overlayZ: 0.7,
			posedOverlayPlanes: [
				{
					overlayId: 'card',
					z: -0.18,
					pose: { yaw: 10, pitch: -3, roll: 0 },
					pivot: { x: 0.8, y: 0.2 }
				}
			],
			time: 0
		});
		for (const [u, v] of [
			[0.8, 0.2],
			[0.1, 0.9],
			[0.5, 0.5]
		]) {
			const frame = projector.projectPoint(posedOverlayStagePlane('card'), u, v);
			const back = projector.raycastPoint(posedOverlayStagePlane('card'), frame.x, frame.y);
			assert.ok(back !== null);
			assert.ok(Math.abs(back.x - u) < 1e-6 && Math.abs(back.y - v) < 1e-6, `${u},${v}`);
		}
		const shared = projector.projectPoint('overlay', 0.5, 0.5);
		const unknown = projector.projectPoint(posedOverlayStagePlane('missing'), 0.5, 0.5);
		assert.deepEqual(unknown, shared);
	});
});
