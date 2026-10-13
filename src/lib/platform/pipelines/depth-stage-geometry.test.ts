import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import { vec4 } from 'wgpu-matrix';

import { StageSchema } from '$lib/platform/engine-schema';
import { getStageModel } from '../stage-models';
import { createStageCameraRig, STAGE_CAM_Z, stagePlaneHalfExtents } from './depth-stage-camera';
import {
	assertStageBodyCeilings,
	createStageShadowProjection,
	resolveStageBodyFocusPull,
	resolveStageFloorBasis,
	resolveStageScreenBodyPlacement,
	resolveStageScreenGlass,
	STAGE_BODY_CEILINGS,
	STAGE_FLOOR_REACH,
	StageBodyCeilingError,
	projectStageBodyFrameBounds,
	resolveStageFramedBodyModel,
	stageBodyBoundingSphere
} from './depth-stage-geometry';

const crt = getStageModel('crt-fw900');

describe('resolveStageScreenGlass', () => {
	it('covers a horizontal frame with the opening width and shows almost all of it', () => {
		assert.ok(crt);
		const glass = resolveStageScreenGlass(16 / 9, crt.screen);
		const { halfW, halfH } = stagePlaneHalfExtents(STAGE_CAM_Z, 16 / 9);
		// The FW900 opening (523×295) is a hair taller than 16:9, so the height
		// sets the scale and a sliver of width is cropped.
		assert.ok(Math.abs(glass.basis.v[1] - halfH) < 1e-9);
		assert.ok(glass.basis.u[0] <= halfW + 1e-9);
		assert.ok(glass.uvWindow[3] === 1 && glass.uvWindow[2] > 0.99 && glass.uvWindow[2] <= 1);
		assert.ok(Math.abs(glass.uvWindow[0] - (1 - glass.uvWindow[2]) / 2) < 1e-12);
		assert.ok(glass.scale > 0);
	});

	it('shows the middle band of a vertical frame through a landscape opening', () => {
		assert.ok(crt);
		const glass = resolveStageScreenGlass(9 / 16, crt.screen);
		const { halfW, halfH } = stagePlaneHalfExtents(STAGE_CAM_Z, 9 / 16);
		assert.ok(Math.abs(glass.basis.u[0] - halfW) < 1e-9, 'opening width matches the frame');
		assert.ok(glass.basis.v[1] < halfH, 'opening is shorter than the frame');
		assert.equal(glass.uvWindow[2], 1);
		assert.ok(glass.uvWindow[3] < 0.6 && glass.uvWindow[3] > 0.2);
		assert.ok(Math.abs(glass.uvWindow[1] - (1 - glass.uvWindow[3]) / 2) < 1e-12);
	});
});

describe('resolveStageScreenBodyPlacement', () => {
	it('lands the model screen centre on the origin with the housing proud of the glass', () => {
		assert.ok(crt);
		const mesh = { min: [-304.5, -288, -522] as const, max: [304.5, 173.5, 0] as const };
		const placement = resolveStageScreenBodyPlacement(16 / 9, crt, {
			min: [...mesh.min],
			max: [...mesh.max]
		});
		const s = placement.glass.scale;
		const centre = vec4.transformMat4(
			[crt.screen.center[0], crt.screen.center[1], crt.screen.center[2], 1],
			placement.model
		);
		// Float32 matrices: compare at float32 precision.
		assert.ok(Math.abs(centre[0]) < 1e-6 && Math.abs(centre[1]) < 1e-6 && Math.abs(centre[2]) < 1e-6);
		// The front face (model z 0) stands proud of the glass by the glass's
		// authored depth inside the housing.
		const front = vec4.transformMat4([0, 0, 0, 1], placement.model);
		assert.ok(Math.abs(front[2] - -crt.screen.center[2] * s) < 1e-6);
		assert.ok(front[2] > 0);
		assert.ok(placement.radius > 0 && placement.center[2] < 0, 'the body sits behind its glass');
		// Uniform scale, no rotation.
		assert.ok(Math.abs(placement.model[0] - s) < 1e-6 && Math.abs(placement.model[5] - s) < 1e-6);
		assert.equal(placement.model[1], 0);
	});
});

describe('resolveStageFloorBasis', () => {
	it('lays a horizontal floor at the model underside, running from the camera side to the backdrop', () => {
		assert.ok(crt);
		const placement = resolveStageScreenBodyPlacement(16 / 9, crt, {
			min: [-304.5, -288, -522],
			max: [304.5, 173.5, 0]
		});
		assert.ok(placement.floorY !== null && placement.floorY < 0, 'the underside sits below the glass centre');
		const floor = resolveStageFloorBasis(16 / 9, placement.floorY, 1.2);
		assert.deepEqual(floor.normal, [0, 1, 0]);
		assert.equal(floor.origin[1], placement.floorY);
		assert.ok(floor.origin[2] - floor.v[2] >= STAGE_FLOOR_REACH.front - 1e-9, 'reaches in front of the model');
		assert.ok(Math.abs(floor.origin[2] + floor.v[2] + STAGE_FLOOR_REACH.back) < 1e-9, 'meets the backdrop');
		assert.ok(floor.u[0] > 0 && floor.v[2] < 0);
	});
});

describe('resolveStageBodyFocusPull', () => {
	const eye: [number, number, number] = [0, 0, STAGE_CAM_Z];
	const forward: [number, number, number] = [0, 0, -1];

	it('racks to the nearest present body by its presence and ignores absent ones', () => {
		const pull = resolveStageBodyFocusPull(
			[
				{ center: [0, 0, 0.5], presence: 0.4 },
				{ center: [0.2, 0, 0.9], presence: 1 },
				{ center: [0, 0, 3], presence: 0 }
			],
			eye,
			forward
		);
		assert.ok(pull);
		assert.ok(Math.abs(pull.distance - (STAGE_CAM_Z - 0.9)) < 1e-9);
		assert.equal(pull.pull, 1);
		assert.equal(resolveStageBodyFocusPull([{ center: [0, 0, 0], presence: 0 }], eye, forward), null);
		assert.equal(resolveStageBodyFocusPull([], eye, forward), null);
	});
});

describe('createStageShadowProjection', () => {
	it('fits the casters and maps them inside the light clip volume', () => {
		const direction: [number, number, number] = [0.14, -0.16, -0.977];
		const casters = [
			{ center: [0.4, -0.2, 0.3] as [number, number, number], radius: 0.5 },
			{ center: [-0.3, 0.1, 0.1] as [number, number, number], radius: 0.2 }
		];
		const projection = createStageShadowProjection(direction, casters, 3);
		assert.ok(projection);
		const viewProjection: Float32Array = projection.viewProjection;
		assert.ok(Math.abs(Math.hypot(...projection.direction) - 1) < 1e-9);
		for (const caster of casters) {
			for (const sign of [-1, 1]) {
				const point: number[] = caster.center.map((c) => c + sign * caster.radius);
				const clip: Float32Array = vec4.transformMat4(
					[point[0], point[1], point[2], 1],
					viewProjection
				) as Float32Array;
				assert.ok(Math.abs(clip[0]) <= 1 && Math.abs(clip[1]) <= 1, 'inside the footprint');
				assert.ok(clip[2] >= 0 && clip[2] <= 1, 'inside the depth range');
			}
		}
		// A receiver straight behind the casters along the light is still in range.
		const behind = vec4.transformMat4(
			[0, 0, 0.2 + direction[2] * 2.5, 1],
			projection.viewProjection
		);
		assert.ok(behind[2] > 0 && behind[2] <= 1);
		assert.ok(projection.extent > 2 * (0.5 + 0.2));
		assert.equal(createStageShadowProjection(direction, [], 3), null);
	});
});

describe('assertStageBodyCeilings', () => {
	it('throws the first ceiling a budget exceeds, naming it', () => {
		const within = { bodyCount: 1, vertexCount: 1000, indexCount: 6000, meshBytes: 1, residentBytes: 1 };
		assert.doesNotThrow(() => assertStageBodyCeilings(within));
		assert.throws(
			() => assertStageBodyCeilings({ ...within, bodyCount: STAGE_BODY_CEILINGS.maxBodies + 1 }),
			(error: unknown) => error instanceof StageBodyCeilingError && error.ceiling === 'maxBodies'
		);
		assert.throws(
			() =>
				assertStageBodyCeilings({
					...within,
					residentBytes: STAGE_BODY_CEILINGS.maxResidentBytes + 1
				}),
			(error: unknown) =>
				error instanceof StageBodyCeilingError && error.ceiling === 'maxResidentBytes'
		);
	});

	it('keeps the registered CRT inside the ceilings', () => {
		assert.ok(crt);
		assert.doesNotThrow(() =>
			assertStageBodyCeilings({
				bodyCount: 1,
				vertexCount: crt.vertices,
				indexCount: crt.triangles * 3,
				meshBytes: crt.vertices * 28 + crt.triangles * 12,
				residentBytes: 0
			})
		);
	});
});

describe('projectStageBodyFrameBounds', () => {
	// A mesh made of a box's eight corners: enough vertices for a silhouette.
	function cornerMesh(min: [number, number, number], max: [number, number, number]) {
		const corners: number[] = [];
		for (const x of [min[0], max[0]]) {
			for (const y of [min[1], max[1]]) {
				for (const z of [min[2], max[2]]) corners.push(x, y, z, 0, 0, 1, 0);
			}
		}
		return { min, max, vertices: new Float32Array(corners), vertexCount: 8 };
	}
	const mesh = cornerMesh([-320, -288, -240], [320, 190, 0]);

	it('frames the housing around the glass under the frontal camera', () => {
		assert.ok(crt);
		const camera = StageSchema.parse({ type: 'depth' }).camera;
		const box = projectStageBodyFrameBounds({ aspect: 16 / 9, camera, time: 0, model: crt, mesh });
		assert.ok(box);
		// The glass fits inside the frame; the housing stands proud of it on every side.
		assert.ok(box.left < 0.5 && box.left + box.width > 0.5, 'spans the centre horizontally');
		assert.ok(box.top < 0.5 && box.top + box.height > 0.5, 'spans the centre vertically');
		assert.ok(box.width > 0.6, 'wider than the glass fit');
		assert.ok(box.height > 0.6, 'taller than the glass fit');
	});

	it('moves with the camera: a pulled-back pose frames a smaller box', () => {
		assert.ok(crt);
		const near = StageSchema.parse({ type: 'depth' }).camera;
		const far = StageSchema.parse({ type: 'depth', camera: { pose: { distance: 1.9 } } }).camera;
		const nearBox = projectStageBodyFrameBounds({ aspect: 16 / 9, camera: near, time: 0, model: crt, mesh });
		const farBox = projectStageBodyFrameBounds({ aspect: 16 / 9, camera: far, time: 0, model: crt, mesh });
		assert.ok(nearBox && farBox);
		assert.ok(farBox.width < nearBox.width);
		assert.ok(farBox.height < nearBox.height);
	});

	it('returns nothing when the whole body lies behind the eye', () => {
		assert.ok(crt);
		const camera = StageSchema.parse({ type: 'depth' }).camera;
		const behind = cornerMesh([-10, -10, 5000], [10, 10, 5100]);
		assert.equal(projectStageBodyFrameBounds({ aspect: 16 / 9, camera, time: 0, model: crt, mesh: behind }), null);
	});
});

describe('framed bodies (ADR-0062)', () => {
	const camera = StageSchema.parse({ type: 'depth' }).camera;
	const rig = createStageCameraRig({ aspect: 16 / 9, camera, time: 0 });
	const placement = {
		pivot: { x: 0.5, y: 0.5 },
		z: 0,
		unitFraction: 0.1,
		baselineOffset: -0.5,
		lift: 0,
		lean: 0
	};

	it('scales one body unit to the declared fraction of the frame height at the plane', () => {
		const model = resolveStageFramedBodyModel({ rig, aspect: 16 / 9, placement });
		const halfH = stagePlaneHalfExtents(STAGE_CAM_Z, 16 / 9).halfH;
		const unit = Math.hypot(model[4], model[5], model[6]);
		assert.ok(Math.abs(unit - halfH * 2 * 0.1) < 1e-6, 'v column is one unit');
		assert.ok(Math.abs(Math.hypot(model[0], model[1], model[2]) - unit) < 1e-6, 'uniform');
		// The origin sits half a unit below the pivot (the baseline offset) on the Surface plane.
		assert.ok(Math.abs(model[12]) < 1e-6 && Math.abs(model[13] + unit * 0.5) < 1e-6 && Math.abs(model[14]) < 1e-6);
	});

	it('lifts along the normal and leans about the horizontal axis', () => {
		const lifted = resolveStageFramedBodyModel({ rig, aspect: 16 / 9, placement: { ...placement, lift: 2 } });
		const unit = Math.hypot(lifted[4], lifted[5], lifted[6]);
		assert.ok(Math.abs(lifted[14] - 2 * unit) < 1e-6, 'lifted toward the eye by two units');
		const leaning = resolveStageFramedBodyModel({ rig, aspect: 16 / 9, placement: { ...placement, lean: 30 } });
		assert.ok(leaning[6] < 0, 'the v axis tips away from the eye');
		assert.ok(Math.abs(Math.hypot(leaning[4], leaning[5], leaning[6]) - unit) < 1e-6);
	});

	it('bounds a placed mesh by its transformed corners', () => {
		const model = resolveStageFramedBodyModel({ rig, aspect: 16 / 9, placement });
		const sphere = stageBodyBoundingSphere(model, { min: [-2, 0, 0], max: [2, 1, 0.3] });
		const unit = Math.hypot(model[4], model[5], model[6]);
		assert.ok(Math.abs(sphere.center[1] - (model[13] + 0.5 * unit)) < 1e-6, 'centred on the box');
		assert.ok(Math.abs(sphere.radius - Math.hypot(2, 0.5, 0.15) * unit) < 1e-6);
	});
});
