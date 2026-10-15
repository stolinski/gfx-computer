import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';
import { vec4 } from 'wgpu-matrix';

import { StageSchema, type StageCamera } from '$lib/platform/engine-schema';
import {
	createStageCameraRig,
	resolveStageCameraForOrientation,
	resolveStageCameraPose,
	STAGE_BACKDROP_COVER_MIN,
	STAGE_BACKDROP_DEPTH,
	STAGE_CAM_Z,
	STAGE_CAMERA_REST_POSE,
	STAGE_DEPTH_FAR,
	STAGE_DEPTH_NEAR,
	stageBackdropCover,
	stageCameraFrameRay,
	stageCameraMoveOffset,
	stageCameraTravelMoves,
	stageSurfaceFootprint,
	stageDepthEncoding
} from './depth-stage-camera';
import { createStageProjector } from './depth-stage-planes';

const ASPECT = 3840 / 2160;

function camera(overrides: Record<string, unknown> = {}): StageCamera {
	return StageSchema.parse({ type: 'depth', camera: overrides }).camera;
}

function close(actual: number, expected: number, epsilon = 1e-6, message?: string): void {
	assert.ok(Math.abs(actual - expected) <= epsilon, message ?? `${actual} ≈ ${expected}`);
}

describe('stage camera rig — the shipped frontal camera is the default', () => {
	it('reproduces the legacy push eye bit-for-bit with no pose authored', () => {
		for (const time of [0, 0.3, 0.77, 1]) {
			const rig = createStageCameraRig({
				aspect: ASPECT,
				camera: camera({ move: 'push', amount: 0.6 }),
				time
			});
			const offset = stageCameraMoveOffset('push', 0.6, time);
			assert.deepEqual(rig.eye, [0, 0, STAGE_CAM_Z + offset.dolly]);
			assert.deepEqual(rig.aim, [0, 0, 0]);
			assert.deepEqual(rig.up, [0, 1, 0]);
			assert.equal(rig.aimDistance, STAGE_CAM_Z + offset.dolly);
			assert.equal(rig.backdropDistance, STAGE_CAM_Z + offset.dolly + STAGE_BACKDROP_DEPTH);
		}
	});

	it('slides the legacy drift along the camera right axis', () => {
		const rig = createStageCameraRig({
			aspect: ASPECT,
			camera: camera({ move: 'drift', amount: 1 }),
			time: 0.5
		});
		const offset = stageCameraMoveOffset('drift', 1, 0.5);
		assert.deepEqual(rig.eye, [offset.lateral, 0, STAGE_CAM_Z]);
	});

	it('keeps the legacy depth encoding and backdrop cover without a pose', () => {
		const legacy = camera({ move: 'push', amount: 1 });
		assert.deepEqual(stageDepthEncoding(legacy, ASPECT), {
			near: STAGE_DEPTH_NEAR,
			far: STAGE_DEPTH_FAR
		});
		assert.equal(stageBackdropCover(legacy, ASPECT), STAGE_BACKDROP_COVER_MIN);
		assert.equal(stageBackdropCover(camera({ move: 'drift', amount: 1 }), ASPECT), 1.2);
	});
});

describe('stage camera rig — an authored pose orbits the aim point', () => {
	it('swings the eye to the right for positive yaw and above the page for positive pitch', () => {
		const yawed = createStageCameraRig({
			aspect: ASPECT,
			camera: camera({ pose: { yaw: 30 } }),
			time: 0
		});
		assert.ok(yawed.eye[0] > 0);
		assert.ok(yawed.eye[2] > 0 && yawed.eye[2] < STAGE_CAM_Z);
		close(yawed.aimDistance, STAGE_CAM_Z);

		const pitched = createStageCameraRig({
			aspect: ASPECT,
			camera: camera({ pose: { pitch: 20 } }),
			time: 0
		});
		assert.ok(pitched.eye[1] > 0);
		close(pitched.aimDistance, STAGE_CAM_Z);
	});

	it('aims at the authored page point and dollies by distance', () => {
		const rig = createStageCameraRig({
			aspect: ASPECT,
			camera: camera({ pose: { distance: 0.5, aim: { x: 0.75, y: 0.25 } } }),
			time: 0
		});
		assert.ok(rig.aim[0] > 0, 'aim right of centre is +x');
		assert.ok(rig.aim[1] > 0, 'aim above centre is +y');
		close(rig.aimDistance, 0.5 * STAGE_CAM_Z);
		close(rig.eye[0], rig.aim[0]);
		close(rig.eye[1], rig.aim[1]);
	});

	it('tilts the horizon with roll while keeping the line of sight', () => {
		const rig = createStageCameraRig({
			aspect: ASPECT,
			camera: camera({ pose: { roll: 15 } }),
			time: 0
		});
		assert.ok(rig.up[0] > 0 && rig.up[1] > 0);
		assert.deepEqual(rig.eye, [0, 0, STAGE_CAM_Z]);
	});
});

describe('stage camera travel', () => {
	const travelling = camera({
		pose: { yaw: -24, pitch: 7, distance: 0.55, aim: { x: 0.6, y: 0.4 } },
		travel: {
			to: { yaw: -16, distance: 0.48, aim: { x: 0.3 } },
			start: 0.1,
			duration: 0.6,
			ease: 'smooth'
		}
	});

	it('holds the rest pose before the window and the target after it', () => {
		const before = resolveStageCameraPose(travelling, 0.05);
		assert.deepEqual(before, {
			yaw: -24,
			pitch: 7,
			roll: 0,
			distance: 0.55,
			aimX: 0.6,
			aimY: 0.4
		});
		const after = resolveStageCameraPose(travelling, 0.9);
		assert.deepEqual(after, {
			yaw: -16,
			pitch: 7,
			roll: 0,
			distance: 0.48,
			aimX: 0.3,
			aimY: 0.4
		});
	});

	it('eases monotonically between the poses', () => {
		let previousYaw = -24;
		for (let step = 1; step <= 12; step += 1) {
			const pose = resolveStageCameraPose(travelling, 0.1 + (0.6 * step) / 12);
			assert.ok(pose.yaw >= previousYaw);
			assert.ok(pose.pitch === 7 && pose.aimY === 0.4, 'untravelled fields hold');
			previousYaw = pose.yaw;
		}
	});

	it('clamps an overshooting ease to the authored limits', () => {
		const settled = camera({
			pose: { yaw: 0 },
			travel: { to: { yaw: 60 }, start: 0, duration: 1, ease: 'settled' }
		});
		for (let step = 0; step <= 20; step += 1) {
			assert.ok(resolveStageCameraPose(settled, step / 20).yaw <= 60);
		}
	});

	it('resolves without a rest pose from the shipped frontal camera', () => {
		const fromRest = camera({ travel: { to: { yaw: 10 }, start: 0, duration: 1 } });
		assert.deepEqual(resolveStageCameraPose(fromRest, 0), STAGE_CAMERA_REST_POSE);
		assert.equal(resolveStageCameraPose(fromRest, 1).yaw, 10);
	});
});

describe('stage camera travel through several moves', () => {
	const walking = camera({
		pose: { yaw: -16, pitch: -22, distance: 0.8, aim: { x: 0.2, y: 0.4 } },
		travel: [
			{ to: { aim: { x: 0.5 } }, start: 0.2, duration: 0.1, ease: 'smooth' },
			{ to: { aim: { x: 0.8 }, yaw: -10 }, start: 0.5, duration: 0.1, ease: 'smooth' }
		]
	});

	it('holds each landing between moves, and starts each move from the last one', () => {
		assert.equal(resolveStageCameraPose(walking, 0.1).aimX, 0.2);
		assert.equal(resolveStageCameraPose(walking, 0.4).aimX, 0.5);
		assert.equal(resolveStageCameraPose(walking, 0.4).yaw, -16, 'a field a move leaves out holds');
		const landed = resolveStageCameraPose(walking, 0.9);
		assert.equal(landed.aimX, 0.8);
		assert.equal(landed.yaw, -10);
		assert.equal(landed.pitch, -22);
	});

	it('moves monotonically through every move', () => {
		let previousAim = 0.2;
		for (let step = 0; step <= 40; step += 1) {
			const aimX = resolveStageCameraPose(walking, step / 40).aimX;
			assert.ok(aimX >= previousAim - 1e-12);
			previousAim = aimX;
		}
	});

	it('resolves a single move exactly as a list of one', () => {
		const single = camera({
			pose: { yaw: 4 },
			travel: { to: { yaw: 20 }, start: 0.1, duration: 0.5, ease: 'smooth' }
		});
		const listed = camera({
			pose: { yaw: 4 },
			travel: [{ to: { yaw: 20 }, start: 0.1, duration: 0.5, ease: 'smooth' }]
		});
		for (const time of [0, 0.2, 0.35, 0.6, 1]) {
			assert.deepEqual(resolveStageCameraPose(listed, time), resolveStageCameraPose(single, time));
		}
	});

	it('samples a pose held only between moves when it checks the page stays in shot', () => {
		// Swings hard right only between 0.31 and 0.34: the five fixed samples miss it.
		const brief = camera({
			pose: { distance: 0.8 },
			travel: [
				{ to: { yaw: 60, pitch: 45, distance: 2 }, start: 0.31, duration: 0.01, ease: 'smooth' },
				{ to: { yaw: 0, pitch: 0, distance: 0.8 }, start: 0.33, duration: 0.01, ease: 'smooth' }
			]
		});
		assert.ok(stageSurfaceFootprint(brief, ASPECT).overshoot > 0);
	});
});

describe('stage projector under a pose', () => {
	const posed = camera({ pose: { yaw: -24, pitch: 7, distance: 0.55, aim: { x: 0.6, y: 0.4 } } });

	it('round-trips composition points through project and raycast on both planes', () => {
		const projector = createStageProjector({
			aspect: ASPECT,
			camera: posed,
			overlayZ: 0.45,
			time: 0.4
		});
		for (const plane of ['surface', 'overlay'] as const) {
			for (const [u, v] of [
				[0.6, 0.4],
				[0.2, 0.8],
				[0.9, 0.1]
			]) {
				const frame = projector.projectPoint(plane, u, v);
				const back = projector.raycastPoint(plane, frame.x, frame.y);
				assert.ok(back !== null);
				close(back.x, u, 1e-4, `${plane} u`);
				close(back.y, v, 1e-4, `${plane} v`);
			}
		}
	});

	it('lands the aim point at the frame centre', () => {
		const projector = createStageProjector({
			aspect: ASPECT,
			camera: posed,
			overlayZ: 0.7,
			time: 0
		});
		const centre = projector.projectPoint('surface', 0.6, 0.4);
		close(centre.x, 0.5, 1e-4);
		close(centre.y, 0.5, 1e-4);
	});

	it('casts frame rays that agree with the rig matrices, one unit per unit of axial distance', () => {
		for (const [cam, time] of [
			[camera(), 0],
			[posed, 0.4],
			[
				camera({ pose: { yaw: 12, pitch: -9, roll: 15, distance: 1.4, aim: { x: 0.3, y: 0.7 } } }),
				1
			]
		] as const) {
			const rig = createStageCameraRig({ aspect: ASPECT, camera: cam, time });
			for (const [fx, fy] of [
				[0.5, 0.5],
				[0, 0],
				[1, 1],
				[0.2, 0.85]
			]) {
				const ray = stageCameraFrameRay(rig, ASPECT, fx, fy);
				const axial = ray[0] * rig.forward[0] + ray[1] * rig.forward[1] + ray[2] * rig.forward[2];
				close(axial, 1, 1e-9, 'axial unit');
				const along = 2.3;
				const point = [
					rig.eye[0] + ray[0] * along,
					rig.eye[1] + ray[1] * along,
					rig.eye[2] + ray[2] * along,
					1
				];
				const clip = vec4.transformMat4(point, rig.viewProjection);
				close((clip[0] / clip[3] + 1) / 2, fx, 1e-5, `frame x at ${fx},${fy}`);
				close((1 - clip[1] / clip[3]) / 2, fy, 1e-5, `frame y at ${fx},${fy}`);
				close(clip[3], along, 1e-5, 'clip.w is the axial distance');
			}
		}
	});
});

describe('backdrop cover and depth encoding under a pose', () => {
	it('grows the cover for an oblique, pulled-back camera and keeps it bounded', () => {
		const wide = camera({ pose: { yaw: 50, pitch: 30, distance: 2 } });
		const cover = stageBackdropCover(wide, ASPECT);
		assert.ok(cover > STAGE_BACKDROP_COVER_MIN);
		assert.ok(cover <= 4);
	});

	it('brackets every reachable plane distance with the aim inside the range', () => {
		const posed = camera({
			pose: { yaw: -24, pitch: 7, distance: 0.55 },
			travel: { to: { distance: 0.48 }, start: 0, duration: 0.85 }
		});
		const encoding = stageDepthEncoding(posed, ASPECT);
		const rig = createStageCameraRig({ aspect: ASPECT, camera: posed, time: 0 });
		assert.ok(encoding.near < rig.aimDistance && rig.aimDistance < encoding.far);
		assert.ok(encoding.near < STAGE_DEPTH_NEAR, 'a close camera needs a nearer floor');
		assert.ok(encoding.far > rig.backdropDistance);
	});
});

describe('the vertical camera', () => {
	it('a horizontal frame films through the horizontal pose and drops the vertical set', () => {
		const authored = camera({
			pose: { yaw: 14, distance: 1.9 },
			vertical: { pose: { yaw: 2, distance: 1.1 } }
		});
		const resolved = resolveStageCameraForOrientation(authored, 'horizontal');
		assert.equal(resolved.pose?.yaw, 14);
		assert.equal(resolved.vertical, undefined);
	});

	it('a vertical frame replaces each authored field whole and keeps the rest', () => {
		const authored = camera({
			move: 'push',
			pose: { yaw: 14, distance: 1.9 },
			travel: { to: { distance: 1.1 }, start: 0, duration: 0.5 },
			vertical: { pose: { yaw: 2, distance: 1.1 } }
		});
		const resolved = resolveStageCameraForOrientation(authored, 'vertical');
		assert.equal(resolved.move, 'push');
		assert.equal(resolved.pose?.yaw, 2);
		assert.equal(resolved.pose?.distance, 1.1);
		// No vertical travel authored: the horizontal travel still plays.
		assert.equal(stageCameraTravelMoves(resolved.travel)[0]?.to.distance, 1.1);
		assert.equal(resolved.vertical, undefined);
	});

	it('without a vertical set both frames film through the same camera', () => {
		const authored = camera({ pose: { yaw: 14 } });
		assert.deepEqual(
			resolveStageCameraForOrientation(authored, 'vertical'),
			resolveStageCameraForOrientation(authored, 'horizontal')
		);
	});
});
