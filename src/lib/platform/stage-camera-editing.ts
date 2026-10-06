import { STAGE_CAMERA_POSE_LIMITS, type StageCameraPose, type StageCameraTravel } from './engine-schema';

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
export function stageCameraTravelFrom(pose: StageCameraPose): StageCameraTravel {
	return {
		to: { ...pose, aim: { ...pose.aim } },
		start: 0,
		duration: 0.85,
		ease: 'smooth'
	};
}

/** A pose or a travel target: the two objects the pose writers address. */
export type StageCameraPoseTarget = StageCameraPose | StageCameraTravel['to'];

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
