import { mat4, vec4 } from 'wgpu-matrix';

import { evaluateNamedEase } from '$lib/utils/ease-curves';
import { clampNumber } from '$lib/utils/math';
import {
	STAGE_CAMERA_POSE_LIMITS,
	type StageCamera,
	type StageCameraTravel,
	type StageCameraTravelMove
} from '$lib/platform/engine-schema';

// The depth stage's camera model (ADR-0028, posed by ADR-0057), single-sourced
// so the renderer (depth-stage.ts), the frame resolver, and canvas hit-testing
// (CanvasEditingOverlay) share one set of matrices: everything here is a pure,
// frame-deterministic function of the authored `stage.camera` and the clip
// progress, so a projector built from the same state the renderer receives
// reproduces the exact pixel mapping of the staged frame.
//
// The camera ORBITS an aim point on the Surface plane: `pose.aim` picks the
// point (composition fractions), `yaw` / `pitch` swing the eye around it,
// `distance` dollies along the line of sight, `roll` tilts the horizon, and an
// optional `travel` eases every field toward a second pose over an authored
// window, or through several poses in turn. The legacy `move: push | drift` offsets compose on top in the
// camera's own frame. With no pose authored every function below reproduces
// the shipped frontal camera bit-for-bit — that identity is a gate.

export const STAGE_FOV = (42 * Math.PI) / 180;
/** Camera rest distance; the Surface plane sits at the framing distance. */
export const STAGE_CAM_Z = 3.4;
/** World units the backdrop sits behind the Surface plane. */
export const STAGE_BACKDROP_DEPTH = 2.2;
/** The shipped backdrop oversize that keeps the far plane full-bleed across the
 *  legacy push; a posed camera never allocates less. */
export const STAGE_BACKDROP_COVER_MIN = 1.2;
/** The largest backdrop oversize the stage allocates. Beyond it an extreme pose
 *  may look past the far plane; the Preset author keeps the page in shot. */
export const STAGE_BACKDROP_COVER_MAX = 4;
/** Camera-space distances the shipped frontal camera encodes as depth 0 / 1. */
export const STAGE_DEPTH_NEAR = 2.5;
export const STAGE_DEPTH_FAR = 6.0;

export type StageCameraMove = 'static' | 'push' | 'drift';

/** The legacy named move as an offset in the camera's own frame: a lateral
 *  slide along the camera's right axis and a dolly along its line of sight. */
export interface StageCameraMoveOffset {
	lateral: number;
	dolly: number;
}

const smootherstep = (t: number): number => {
	const x = Math.min(1, Math.max(0, t));
	return x * x * x * (x * (x * 6 - 15) + 10);
};

/** The legacy push / drift offset at clip progress `time` (0..1). */
export function stageCameraMoveOffset(
	move: StageCameraMove,
	amount: number,
	time: number
): StageCameraMoveOffset {
	const e = smootherstep(time);
	if (move === 'push') {
		// start pulled back, dolly in
		return { lateral: 0, dolly: 0.55 * amount * (1 - e) };
	}
	if (move === 'drift') {
		// lateral parallax sweep
		return { lateral: (-0.18 + (0.14 - -0.18) * e) * amount, dolly: 0 };
	}
	return { lateral: 0, dolly: 0 };
}

/** Half-extents of a plane that exactly fills the frame at camera distance
 *  `dist` — the stage's framing rule for every plane. */
export function stagePlaneHalfExtents(
	dist: number,
	aspect: number
): { halfW: number; halfH: number } {
	const halfH = Math.tan(STAGE_FOV / 2) * dist;
	return { halfW: halfH * aspect, halfH };
}

/** One fully resolved camera pose: every field explicit, degrees for angles,
 *  `distance` as a fraction of `STAGE_CAM_Z`, the aim in composition fractions
 *  (u right, v down — capture UV space) on the Surface plane. */
export interface StageCameraPoseFrame {
	yaw: number;
	pitch: number;
	roll: number;
	distance: number;
	aimX: number;
	aimY: number;
}

/** The shipped frontal camera: square to the page, centred, at rest distance. */
export const STAGE_CAMERA_REST_POSE: StageCameraPoseFrame = {
	yaw: 0,
	pitch: 0,
	roll: 0,
	distance: 1,
	aimX: 0.5,
	aimY: 0.5
};

/** Whether the composition authored a camera pose or travel (as opposed to
 *  riding the shipped frontal camera, possibly with a legacy move). */
export function hasAuthoredStageCameraPose(camera: StageCamera): boolean {
	return camera.pose !== undefined || camera.travel !== undefined;
}

export type StageFrameOrientation = 'horizontal' | 'vertical';

/**
 * The camera a frame of `orientation` is filmed through: under a vertical
 * frame the authored vertical pose and travel replace their horizontal
 * counterparts whole (ADR-0059). The result carries no `vertical` of its own,
 * so every consumer downstream — the renderer, the projector, the rubric —
 * resolves it exactly once, here.
 */
export function resolveStageCameraForOrientation(
	camera: StageCamera,
	orientation: StageFrameOrientation
): StageCamera {
	const { vertical, ...horizontal } = camera;
	if (orientation !== 'vertical' || !vertical) return horizontal;
	return {
		...horizontal,
		pose: vertical.pose ?? horizontal.pose,
		travel: vertical.travel ?? horizontal.travel
	};
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The moves of a travel in timeline order: a single authored move is a list
 *  of one, so every consumer walks the same shape. */
export function stageCameraTravelMoves(
	travel: StageCameraTravel | undefined
): readonly StageCameraTravelMove[] {
	if (!travel) return [];
	return Array.isArray(travel) ? travel : [travel];
}

function easeStageCameraPose(
	from: StageCameraPoseFrame,
	move: StageCameraTravelMove,
	time: number
): StageCameraPoseFrame {
	const duration = move.duration > 0 ? move.duration : 1;
	const local = clampNumber((time - move.start) / duration, 0, 1);
	const eased = evaluateNamedEase(move.ease, local);
	const to = move.to;
	const limits = STAGE_CAMERA_POSE_LIMITS;
	return {
		yaw: clampNumber(
			mix(from.yaw, to.yaw ?? from.yaw, eased),
			-limits.yawDegrees,
			limits.yawDegrees
		),
		pitch: clampNumber(
			mix(from.pitch, to.pitch ?? from.pitch, eased),
			-limits.pitchDegrees,
			limits.pitchDegrees
		),
		roll: clampNumber(
			mix(from.roll, to.roll ?? from.roll, eased),
			-limits.rollDegrees,
			limits.rollDegrees
		),
		distance: clampNumber(
			mix(from.distance, to.distance ?? from.distance, eased),
			limits.minDistance,
			limits.maxDistance
		),
		aimX: clampNumber(mix(from.aimX, to.aim?.x ?? from.aimX, eased), 0, 1),
		aimY: clampNumber(mix(from.aimY, to.aim?.y ?? from.aimY, eased), 0, 1)
	};
}

/** The camera pose at clip progress `time`: the rest pose carried through each
 *  travel move in order — a move eases from where the previous one landed
 *  toward its own target inside its window — clamped to the authored limits so
 *  an overshooting ease (`settled`, `bouncy`) never leaves the vocabulary. */
export function resolveStageCameraPose(camera: StageCamera, time: number): StageCameraPoseFrame {
	const rest: StageCameraPoseFrame = camera.pose
		? {
				yaw: camera.pose.yaw,
				pitch: camera.pose.pitch,
				roll: camera.pose.roll,
				distance: camera.pose.distance,
				aimX: camera.pose.aim.x,
				aimY: camera.pose.aim.y
			}
		: STAGE_CAMERA_REST_POSE;
	let pose = rest;
	for (const move of stageCameraTravelMoves(camera.travel)) {
		pose = easeStageCameraPose(pose, move, time);
	}
	return pose;
}

type Vec3Tuple = [number, number, number];

const WORLD_UP: Vec3Tuple = [0, 1, 0];

function add(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3Tuple, s: number): Vec3Tuple {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dotProduct(a: Vec3Tuple, b: Vec3Tuple): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v: Vec3Tuple): number {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3Tuple): Vec3Tuple {
	const magnitude = length(v);
	return [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

export interface StageCameraRigInput {
	/** Frame aspect (width / height). */
	aspect: number;
	camera: StageCamera;
	/** Clip progress 0..1 — the same frame-deterministic time the renderer gets. */
	time: number;
}

/** One camera viewpoint: where it is, where it looks, which way is up. */
export interface StageCameraView {
	eye: Vec3Tuple;
	/** Unit line of sight. */
	forward: Vec3Tuple;
	up: Vec3Tuple;
}

/** The camera at one instant, ready for the renderer and the projector. */
export interface StageCameraRig extends StageCameraView {
	pose: StageCameraPoseFrame;
	/** The aim point on the Surface plane, in world units. */
	aim: Vec3Tuple;
	/** The posed camera before the legacy push / drift offset is applied — the
	 *  frame posed Overlay planes are placed in (ADR-0057). Attaching them here
	 *  rather than to `eye` keeps the legacy moves what they always were,
	 *  parallax over world-fixed planes, so every shipped Preset renders as
	 *  before; only an authored pose or travel carries an Overlay with it. */
	anchor: StageCameraView;
	viewProjection: Float32Array;
	/** Camera-space distance from the eye to the aim point — the depth focusZ 0 keeps sharp. */
	aimDistance: number;
	/** Camera-space distance to the backdrop point straight behind the aim — the depth focusZ 1 reaches. */
	backdropDistance: number;
}

/** Build the camera for one frame from the authored `stage.camera` and the
 *  clip progress. Positive `yaw` swings the eye to the page's right, positive
 *  `pitch` lifts it above the page (looking down), positive `roll` tilts the
 *  horizon clockwise on screen. */
export function createStageCameraRig({
	aspect,
	camera,
	time
}: StageCameraRigInput): StageCameraRig {
	const pose = resolveStageCameraPose(camera, time);
	const offset = stageCameraMoveOffset(camera.move, clampNumber(camera.amount, 0, 1), time);
	const { halfW, halfH } = stagePlaneHalfExtents(STAGE_CAM_Z, aspect);
	const aim: Vec3Tuple = [(2 * pose.aimX - 1) * halfW, (1 - 2 * pose.aimY) * halfH, 0];
	const yaw = degreesToRadians(pose.yaw);
	const pitch = degreesToRadians(pose.pitch);
	const roll = degreesToRadians(pose.roll);
	// Unit vector from the aim back toward the camera; at the rest pose exactly +Z.
	const back: Vec3Tuple = [
		Math.cos(pitch) * Math.sin(yaw),
		Math.sin(pitch),
		Math.cos(pitch) * Math.cos(yaw)
	];
	// The camera's right axis at zero roll — the legacy drift slides along it.
	const lateral = normalize(cross(WORLD_UP, back));
	const rolledUp = (forward: Vec3Tuple): Vec3Tuple => {
		if (roll === 0) return WORLD_UP;
		const right = normalize(cross(forward, WORLD_UP));
		const trueUp = cross(right, forward);
		return add(scale(trueUp, Math.cos(roll)), scale(right, Math.sin(roll)));
	};
	const anchorEye = add(aim, scale(back, pose.distance * STAGE_CAM_Z));
	const anchorForward = normalize(subtract(aim, anchorEye));
	const anchor: StageCameraView = {
		eye: anchorEye,
		forward: anchorForward,
		up: rolledUp(anchorForward)
	};
	const eye = add(add(anchorEye, scale(back, offset.dolly)), scale(lateral, offset.lateral));
	const forward = normalize(subtract(aim, eye));
	const up = rolledUp(forward);
	const projection = mat4.perspective(STAGE_FOV, aspect, 0.1, 100);
	const view = mat4.lookAt(eye, aim, up);
	const viewProjection = mat4.multiply(projection, view) as Float32Array;
	// Camera-space (axial) distances — the same quantity the plane pass writes as
	// depth (clip.w), so the focal depth lands exactly on the aimed point.
	const backdropPoint: Vec3Tuple = [aim[0], aim[1], -STAGE_BACKDROP_DEPTH];
	return {
		pose,
		eye,
		aim,
		up,
		forward,
		anchor,
		viewProjection,
		aimDistance: length(subtract(eye, aim)),
		backdropDistance: dotProduct(subtract(backdropPoint, eye), forward)
	};
}

/**
 * The ray from a viewpoint's eye through a frame point (fractions, y down),
 * in world units, scaled so one unit along it is one unit of camera-space
 * (axial) distance — the quantity the plane pass writes as depth. Built from
 * the same look-at basis and field of view the rig's matrices use, so a point
 * placed along this ray projects back to exactly `fx, fy` for that viewpoint.
 */
export function stageCameraFrameRay(
	view: StageCameraView,
	aspect: number,
	fx: number,
	fy: number
): Vec3Tuple {
	const right = normalize(cross(view.forward, view.up));
	const trueUp = cross(right, view.forward);
	const tanHalf = Math.tan(STAGE_FOV / 2);
	const ndcX = 2 * fx - 1;
	const ndcY = 1 - 2 * fy;
	return add(
		view.forward,
		add(scale(right, ndcX * tanHalf * aspect), scale(trueUp, ndcY * tanHalf))
	);
}

interface FrameRayPlaneHit {
	x: number;
	y: number;
	/** Ray parameter from the near plane; negative means the plane lies behind the camera. */
	t: number;
}

// Unproject a frame point at both WebGPU clip depths into a world ray and
// intersect it with the constant-z plane `planeZ`. Null only when the ray runs
// parallel to the plane.
function intersectFrameRayWithPlaneZ(
	inverseViewProjection: Float32Array,
	fx: number,
	fy: number,
	planeZ: number
): FrameRayPlaneHit | null {
	const ndcX = 2 * fx - 1;
	const ndcY = 1 - 2 * fy;
	const near = vec4.transformMat4([ndcX, ndcY, 0, 1], inverseViewProjection);
	const far = vec4.transformMat4([ndcX, ndcY, 1, 1], inverseViewProjection);
	const n = { x: near[0] / near[3], y: near[1] / near[3], z: near[2] / near[3] };
	const f = { x: far[0] / far[3], y: far[1] / far[3], z: far[2] / far[3] };
	const dz = f.z - n.z;
	if (Math.abs(dz) < 1e-8) {
		return null;
	}
	const t = (planeZ - n.z) / dz;
	return { x: n.x + (f.x - n.x) * t, y: n.y + (f.y - n.y) * t, t };
}

const FRAME_CORNERS: readonly [number, number][] = [
	[0, 0],
	[1, 0],
	[0, 1],
	[1, 1]
];
// Progress samples that bracket every authored move: the legacy push is fully
// pulled back at 0, a travel has landed by 1, and the interior samples catch
// an overshooting ease. Each travel move adds its own start, quarters, and end,
// so a pose held only between two moves is never missed.
const MOVE_SAMPLE_TIMES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

function stageCameraSampleTimes(camera: StageCamera): readonly number[] {
	const moves = stageCameraTravelMoves(camera.travel);
	if (moves.length < 2) return MOVE_SAMPLE_TIMES;
	const times = new Set(MOVE_SAMPLE_TIMES);
	for (const move of moves) {
		for (const quarter of [0, 0.25, 0.5, 0.75, 1]) {
			times.add(clampNumber(move.start + move.duration * quarter, 0, 1));
		}
	}
	return [...times].sort((a, b) => a - b);
}

/** The backdrop oversize (cover) this camera needs so no far-plane edge shows
 *  anywhere in the authored move: the frame corners are cast onto the backdrop
 *  plane at each sample time and the widest footprint wins, never below the
 *  shipped 1.2× and never above `STAGE_BACKDROP_COVER_MAX`. */
export function stageBackdropCover(camera: StageCamera, aspect: number): number {
	const fill = stagePlaneHalfExtents(STAGE_CAM_Z + STAGE_BACKDROP_DEPTH, aspect);
	let need = 1;
	for (const time of stageCameraSampleTimes(camera)) {
		const rig = createStageCameraRig({ aspect, camera, time });
		const inverse = mat4.invert(rig.viewProjection) as Float32Array;
		for (const [fx, fy] of FRAME_CORNERS) {
			const hit = intersectFrameRayWithPlaneZ(inverse, fx, fy, -STAGE_BACKDROP_DEPTH);
			if (!hit || hit.t < 0) {
				need = STAGE_BACKDROP_COVER_MAX;
				continue;
			}
			need = Math.max(need, Math.abs(hit.x) / fill.halfW, Math.abs(hit.y) / fill.halfH);
		}
	}
	return clampNumber(
		Math.max(STAGE_BACKDROP_COVER_MIN, need * 1.05),
		STAGE_BACKDROP_COVER_MIN,
		STAGE_BACKDROP_COVER_MAX
	);
}

/** How far the camera looks past the Surface plane in the authored move. */
export interface StageSurfaceFootprint {
	/** The largest fraction of the plane's width or height a frame corner lands
	 *  beyond its edge across the move (0 when every corner stays on the page). */
	overshoot: number;
	/** Clip progress and frame corner of that worst overshoot. */
	time: number;
	corner: { x: number; y: number };
}

/** Where the frame corners land on the Surface plane over the authored move
 *  — the check a filmed page needs, since the Surface plane stays frame-sized
 *  and anything past its edge is backdrop. A corner whose ray never reaches
 *  the plane counts as a full frame of overshoot. */
export function stageSurfaceFootprint(camera: StageCamera, aspect: number): StageSurfaceFootprint {
	const fill = stagePlaneHalfExtents(STAGE_CAM_Z, aspect);
	let worst: StageSurfaceFootprint = { overshoot: 0, time: 0, corner: { x: 0, y: 0 } };
	for (const time of stageCameraSampleTimes(camera)) {
		const rig = createStageCameraRig({ aspect, camera, time });
		const inverse = mat4.invert(rig.viewProjection) as Float32Array;
		for (const [fx, fy] of FRAME_CORNERS) {
			const hit = intersectFrameRayWithPlaneZ(inverse, fx, fy, 0);
			const overshoot =
				!hit || hit.t < 0
					? 1
					: Math.max(0, Math.abs(hit.x) / fill.halfW - 1, Math.abs(hit.y) / fill.halfH - 1) / 2;
			if (overshoot > worst.overshoot) {
				worst = { overshoot, time, corner: { x: fx, y: fy } };
			}
		}
	}
	return worst;
}

/** The camera-space distances a stage encodes as depth 0 and 1. */
export interface StageDepthEncoding {
	near: number;
	far: number;
}

function distanceToRect(
	eye: Vec3Tuple,
	halfW: number,
	halfH: number,
	z: number
): { nearest: number; farthest: number } {
	const closest: Vec3Tuple = [
		clampNumber(eye[0], -halfW, halfW),
		clampNumber(eye[1], -halfH, halfH),
		z
	];
	let farthest = 0;
	for (const sx of [-1, 1]) {
		for (const sy of [-1, 1]) {
			farthest = Math.max(farthest, length(subtract(eye, [sx * halfW, sy * halfH, z])));
		}
	}
	return { nearest: length(subtract(eye, closest)), farthest };
}

/** The depth encoding for this camera. The shipped frontal camera keeps the
 *  legacy pair, so existing Presets stay pixel-identical; an authored pose
 *  widens the pair to the nearest and farthest plane points the move can
 *  reach, and the renderer rescales the DOF so the circle of confusion per
 *  world unit is unchanged. */
export function stageDepthEncoding(camera: StageCamera, aspect: number): StageDepthEncoding {
	if (!hasAuthoredStageCameraPose(camera)) {
		return { near: STAGE_DEPTH_NEAR, far: STAGE_DEPTH_FAR };
	}
	const surface = stagePlaneHalfExtents(STAGE_CAM_Z, aspect);
	const backdrop = stagePlaneHalfExtents(STAGE_CAM_Z + STAGE_BACKDROP_DEPTH, aspect);
	const cover = stageBackdropCover(camera, aspect);
	let nearest = Number.POSITIVE_INFINITY;
	let farthest = 0;
	for (const time of stageCameraSampleTimes(camera)) {
		const { eye } = createStageCameraRig({ aspect, camera, time });
		const onSurface = distanceToRect(eye, surface.halfW, surface.halfH, 0);
		const onBackdrop = distanceToRect(
			eye,
			backdrop.halfW * cover,
			backdrop.halfH * cover,
			-STAGE_BACKDROP_DEPTH
		);
		nearest = Math.min(nearest, onSurface.nearest, onBackdrop.nearest);
		farthest = Math.max(farthest, onSurface.farthest, onBackdrop.farthest);
	}
	return { near: Math.max(0.15, nearest * 0.9), far: farthest * 1.1 };
}
