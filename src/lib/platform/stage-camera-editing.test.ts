import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { STAGE_CAMERA_POSE_LIMITS } from './engine-schema';
import {
	appendStageCameraTravelMove,
	canAppendStageCameraTravelMove,
	parseUnitIntervalInput,
	removeStageCameraTravelMove,
	restStageCameraPose,
	setStageCameraPoseAim,
	setStageCameraPoseAngle,
	setStageCameraPoseDistance,
	STAGE_ORBIT_DEGREES_PER_FRAME_HEIGHT,
	stageCameraPoseBeforeMove,
	stageCameraTravelFrom,
	stageDollyDistance,
	stageOrbitDegreesForDrag
} from './stage-camera-editing';

describe('stage camera editing', () => {
	it('starts a travel as a copy of the pose, aim included, sharing nothing', () => {
		const pose = restStageCameraPose();
		const travel = stageCameraTravelFrom(pose);
		assert.deepEqual(travel.to, pose);
		assert.notEqual(travel.to.aim, pose.aim);
		assert.deepEqual([travel.start, travel.duration, travel.ease], [0, 0.85, 'smooth']);
	});

	it('clamps every pose writer to the authored limits and ignores nonsense', () => {
		const pose = restStageCameraPose();
		setStageCameraPoseAngle(pose, 'yaw', 500, STAGE_CAMERA_POSE_LIMITS.yawDegrees);
		setStageCameraPoseAngle(pose, 'pitch', Number.NaN, STAGE_CAMERA_POSE_LIMITS.pitchDegrees);
		setStageCameraPoseDistance(pose, 0);
		setStageCameraPoseAim(pose, 'x', 3);
		assert.equal(pose.yaw, STAGE_CAMERA_POSE_LIMITS.yawDegrees);
		assert.equal(pose.pitch, 0);
		assert.equal(pose.distance, STAGE_CAMERA_POSE_LIMITS.minDistance);
		assert.deepEqual(pose.aim, { x: 1, y: 0.5 });
		assert.equal(parseUnitIntervalInput('1.5'), 1);
		assert.equal(parseUnitIntervalInput('abc'), null);
	});

	it('orbits the same angle for the same hand travel at any zoom', () => {
		assert.equal(stageOrbitDegreesForDrag(400, 400), STAGE_ORBIT_DEGREES_PER_FRAME_HEIGHT);
		assert.equal(stageOrbitDegreesForDrag(100, 800), STAGE_ORBIT_DEGREES_PER_FRAME_HEIGHT / 8);
		assert.equal(stageOrbitDegreesForDrag(100, 0), 0);
	});

	it('dollies geometrically and stays inside the pose limits', () => {
		const pushedIn = stageDollyDistance(1, -200);
		const pulledBack = stageDollyDistance(1, 200);
		assert.ok(pushedIn < 1 && pulledBack > 1);
		assert.ok(Math.abs(pushedIn * pulledBack - 1) < 1e-9, 'equal and opposite wheels cancel');
		assert.equal(stageDollyDistance(1, -100000), STAGE_CAMERA_POSE_LIMITS.minDistance);
		assert.equal(stageDollyDistance(1, 100000), STAGE_CAMERA_POSE_LIMITS.maxDistance);
	});
});

describe('stage camera travel moves', () => {
	const first = { to: { aim: { x: 0.5 } }, start: 0.1, duration: 0.2, ease: 'smooth' as const };

	it('adds a move that starts where the last one ends and holds its pose', () => {
		const travel = appendStageCameraTravelMove(first);
		assert.ok(Array.isArray(travel));
		assert.equal(travel.length, 2);
		assert.deepEqual(travel[1], {
			to: {},
			start: 0.30000000000000004,
			duration: 0.2,
			ease: 'smooth'
		});
	});

	it('writes one remaining move as a single move, and none as no travel', () => {
		const two = appendStageCameraTravelMove(first);
		assert.deepEqual(removeStageCameraTravelMove(two, 1), first);
		assert.equal(removeStageCameraTravelMove(first, 0), undefined);
	});

	it('offers no move once the clip is used up or the list is full', () => {
		assert.equal(canAppendStageCameraTravelMove({ ...first, start: 0.5, duration: 0.5 }), false);
		const seven = Array.from({ length: 7 }, (_, index) => ({
			...first,
			start: index * 0.05,
			duration: 0.05
		}));
		const eight = appendStageCameraTravelMove(seven);
		assert.equal(Array.isArray(eight) ? eight.length : 1, 8);
		assert.equal(canAppendStageCameraTravelMove(eight), false);
	});

	it('reads the pose a move starts from through every earlier move', () => {
		const rest = { ...restStageCameraPose(), yaw: -10, aim: { x: 0.2, y: 0.4 } };
		const travel = [first, { to: { yaw: 5 }, start: 0.4, duration: 0.1, ease: 'smooth' as const }];
		assert.deepEqual(stageCameraPoseBeforeMove(rest, travel, 0).aim, { x: 0.2, y: 0.4 });
		const second = stageCameraPoseBeforeMove(rest, travel, 1);
		assert.deepEqual([second.yaw, second.aim.x], [-10, 0.5]);
	});
});
