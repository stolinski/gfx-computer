import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { STAGE_CAMERA_POSE_LIMITS } from './engine-schema';
import {
	parseUnitIntervalInput,
	restStageCameraPose,
	setStageCameraPoseAim,
	setStageCameraPoseAngle,
	setStageCameraPoseDistance,
	STAGE_ORBIT_DEGREES_PER_FRAME_HEIGHT,
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
