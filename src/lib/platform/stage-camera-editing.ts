import {
	STAGE_CAMERA_POSE_LIMITS,
	STAGE_CAMERA_TRAVEL_MAX_MOVES,
	type StageCameraPose,
	type StageCameraTravel,
	type StageCameraTravelMove
} from './engine-schema';
import { resolveStageCameraPose, stageCameraTravelMoves } from './pipelines/depth-stage-camera';

// The stage camera's editing vocabulary shared by the Camera inspector and the
// canvas gestures (ADR-0060): the rest pose a new pose starts from, a travel
// that starts as a copy of a pose, and the clamped writers every pose field
// goes through, so the inspector, an orbit on the canvas, and a travel target
// all obey `STAGE_CAMERA_POSE_LIMITS` the same way.

/** The shipped frontal camera as an authored pose: turning a pose on changes nothing until a field moves. */
export function restStageCameraPose(): StageCameraPose {
	return { yaw: 0, pitch: 0, roll: 0, distance: 1, aim: { x: 0.5, y: 0.5 } };
}

/** A travel that starts as a copy of `pose`, so turning the travel on changes nothing until its target moves. */
export function stageCameraTravelFrom(pose: StageCameraPose): StageCameraTravelMove {
	return {
		to: { ...pose, aim: { ...pose.aim } },
		start: 0,
		duration: 0.85,
		ease: 'smooth'
	};
}

/** A pose or a travel target: the two objects the pose writers address. */
export type StageCameraPoseTarget = StageCameraPose | StageCameraTravelMove['to'];

/** Longest window a newly added camera move gets, as a timeline fraction. */
const ADDED_STAGE_CAMERA_MOVE_DURATION = 0.2;

/** Whether one more move fits: under the move limit, with time left after the last move. */
export function canAppendStageCameraTravelMove(travel: StageCameraTravel | undefined): boolean {
	const moves = stageCameraTravelMoves(travel);
	const last = moves.at(-1);
	return moves.length < STAGE_CAMERA_TRAVEL_MAX_MOVES && (!last || last.start + last.duration < 1);
}

/** The travel with one more move after the last: it starts where the last move
 *  ends and holds that pose (an empty target) until a field moves. */
export function appendStageCameraTravelMove(travel: StageCameraTravel): StageCameraTravel {
	const moves = stageCameraTravelMoves(travel);
	const last = moves.at(-1);
	const start = last ? Math.min(1, last.start + last.duration) : 0;
	const added: StageCameraTravelMove = {
		to: {},
		start,
		duration: Math.min(ADDED_STAGE_CAMERA_MOVE_DURATION, 1 - start),
		ease: 'smooth'
	};
	return [...moves, added];
}

/** The travel without move `index`; one move left is written as a single move, none as no travel. */
export function removeStageCameraTravelMove(
	travel: StageCameraTravel,
	index: number
): StageCameraTravel | undefined {
	const remaining = stageCameraTravelMoves(travel).filter((_, at) => at !== index);
	if (remaining.length === 0) return undefined;
	return remaining.length === 1 ? remaining[0] : remaining;
}

export function setStageCameraPoseAngle(
	target: StageCameraPoseTarget,
	key: 'yaw' | 'pitch' | 'roll',
	value: number,
	limit: number
): void {
	if (!Number.isFinite(value)) return;
	target[key] = Math.max(-limit, Math.min(limit, value));
}

export function setStageCameraPoseDistance(target: StageCameraPoseTarget, value: number): void {
	if (!Number.isFinite(value)) return;
	target.distance = Math.max(
		STAGE_CAMERA_POSE_LIMITS.minDistance,
		Math.min(STAGE_CAMERA_POSE_LIMITS.maxDistance, value)
	);
}

export function setStageCameraPoseAim(
	target: StageCameraPoseTarget,
	axis: 'x' | 'y',
	value: number
): void {
	if (!Number.isFinite(value)) return;
	const aim = target.aim ?? { x: 0.5, y: 0.5 };
	target.aim = { x: aim.x ?? 0.5, y: aim.y ?? 0.5, [axis]: Math.max(0, Math.min(1, value)) };
}

/** A field's text as a 0..1 fraction, or null when it is not a number. */
export function parseUnitIntervalInput(value: string): number | null {
	const n = Number(value);
	return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

/** Dragging across the whole rendered frame height orbits the camera this far. */
export const STAGE_ORBIT_DEGREES_PER_FRAME_HEIGHT = 90;

/**
 * The orbit a drag of `deltaPx` makes on a frame drawn `frameHeightPx` tall
 * (ADR-0060 §4): the same hand travel orbits the same angle at every zoom.
 */
export function stageOrbitDegreesForDrag(deltaPx: number, frameHeightPx: number): number {
	if (!(frameHeightPx > 0)) return 0;
	return (deltaPx / frameHeightPx) * STAGE_ORBIT_DEGREES_PER_FRAME_HEIGHT;
}

/** One wheel pixel dollies the distance by this factor, applied geometrically. */
export const STAGE_DOLLY_PER_WHEEL_PIXEL = 0.0015;

/**
 * The distance after a wheel of `wheelDeltaY` pixels (ADR-0060 §4): rolling
 * toward the page pushes in, geometric so the feel is even across the range,
 * clamped to the pose limits.
 */
export function stageDollyDistance(distance: number, wheelDeltaY: number): number {
	const next = distance * Math.exp(wheelDeltaY * STAGE_DOLLY_PER_WHEEL_PIXEL);
	return Math.max(
		STAGE_CAMERA_POSE_LIMITS.minDistance,
		Math.min(STAGE_CAMERA_POSE_LIMITS.maxDistance, next)
	);
}

/** The pose move `index` starts from — the rest pose carried through every
 *  earlier move — which is what a target field it leaves out holds. */
export function stageCameraPoseBeforeMove(
	rest: StageCameraPose | undefined,
	travel: StageCameraTravel,
	index: number
): StageCameraPose {
	const earlier = stageCameraTravelMoves(travel).slice(0, index);
	const frame = resolveStageCameraPose(
		{
			move: 'static',
			amount: 0,
			ease: 'smooth',
			pose: rest,
			travel: earlier.length ? earlier : undefined
		},
		1
	);
	return {
		yaw: frame.yaw,
		pitch: frame.pitch,
		roll: frame.roll,
		distance: frame.distance,
		aim: { x: frame.aimX, y: frame.aimY }
	};
}
