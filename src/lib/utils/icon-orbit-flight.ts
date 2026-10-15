import { createSeededRandom } from './seeded';

/**
 * The flight of one Icon Orbit icon (the `icon-orbit` Overlay): it launches
 * from below the frame, springs up into its place around the subject with a
 * little overshoot, then circles the subject slowly in depth, so it passes
 * behind and in front of them. Positions are frame fractions (x right, y
 * down); `nearness` is the depth, 1 nearest the camera, -1 straight behind
 * the subject.
 *
 * Everything is a pure function of the clip time: the spring is integrated
 * from the launch at a fixed step, so preview and export land on the same
 * pixels whatever order frames are drawn in.
 */
export interface IconOrbitFlightPlan {
	/** Seconds into the clip when the icon leaves the bottom of the frame. */
	launchSeconds: number;
	/** Where along the bottom edge it launches from (frame fraction). */
	launchX: number;
	/**
	 * Its place on the ring: 0 faces the camera, 90 is the viewer's right. The
	 * ring turns as one, so icons keep their spacing whenever they launch.
	 */
	angleDegrees: number;
	/** The height it settles at (frame fraction from the top). */
	height: number;
	/** Varies the launch spin and the bob so no two icons move alike. */
	seed: number;
}

export interface IconOrbitSettings {
	/** The subject's centre line the icons circle (frame fraction). */
	centerX: number;
	/** How far from that line an icon at 90 degrees sits (frame fraction). */
	radius: number;
	/** Degrees an icon travels around the subject per second once it lands. */
	turnDegreesPerSecond: number;
	/**
	 * How far the ring tilts (frame fraction): the front of the orbit sits this
	 * much lower and the back this much higher, like a ring around the
	 * subject's shoulders, so icons pass in front of the chest, not the face.
	 */
	tilt: number;
}

export interface IconOrbitPoint {
	x: number;
	y: number;
	nearness: number;
}

export interface IconOrbitFlightFrame extends IconOrbitPoint {
	/** False before launch. */
	isLaunched: boolean;
	/** Seconds since launch (0 before it). */
	age: number;
	/** Screen speed in frame fractions per second, for motion streaks. */
	speed: number;
	/** Lean in degrees, following sideways motion. */
	lean: number;
	/** Every position since launch at 1/60 s, for particles born along the path. */
	history: readonly IconOrbitPoint[];
}

const SIMULATION_STEP_SECONDS = 1 / 240;
const HISTORY_STEP_SECONDS = 1 / 60;
/** Starts a little below the frame so the icon enters already moving. */
const LAUNCH_Y = 1.16;
/**
 * Spring frequency (Hz) and damping ratio: a slow, airy rise with almost no
 * overshoot, settling over about three seconds. Scott found a fast launch read
 * as fireworks on 2026-10-15; the icons should float up like fairies.
 */
const SPRING_HERTZ = 0.42;
const SPRING_DAMPING = 0.9;
const LAUNCH_SPEED = 0.55;
/**
 * The wander that makes the rise drift instead of shoot: a slow sideways and
 * depth sway that is strongest while rising and fades to a faint drift once
 * the icon has arrived.
 */
const WANDER_AMPLITUDE = 0.045;
const WANDER_REST_AMPLITUDE = 0.006;
const WANDER_HERTZ = 0.32;
const WANDER_FADE_SECONDS = 2.8;
const BOB_AMPLITUDE = 0.006;
const BOB_HERTZ = 0.22;

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

/** Where an icon wants to be `age` seconds after launch: its slot on the turning ring. */
export function iconOrbitTarget(
	plan: IconOrbitFlightPlan,
	settings: IconOrbitSettings,
	age: number,
	bobPhase: number
): IconOrbitPoint {
	const clipSeconds = plan.launchSeconds + age;
	const angle = degreesToRadians(plan.angleDegrees + settings.turnDegreesPerSecond * clipSeconds);
	const nearness = Math.cos(angle);
	const wander =
		WANDER_REST_AMPLITUDE +
		(WANDER_AMPLITUDE - WANDER_REST_AMPLITUDE) * Math.exp(-age / WANDER_FADE_SECONDS);
	return {
		x:
			settings.centerX +
			settings.radius * Math.sin(angle) +
			wander * Math.sin(2 * Math.PI * WANDER_HERTZ * age + bobPhase),
		y:
			plan.height +
			settings.tilt * nearness +
			BOB_AMPLITUDE * Math.sin(2 * Math.PI * BOB_HERTZ * age + bobPhase),
		nearness
	};
}

/** The icon at `timeSeconds` into the clip. */
export function resolveIconOrbitFlight(
	plan: IconOrbitFlightPlan,
	settings: IconOrbitSettings,
	timeSeconds: number
): IconOrbitFlightFrame {
	const age = timeSeconds - plan.launchSeconds;
	if (age < 0) {
		return {
			x: plan.launchX,
			y: LAUNCH_Y,
			nearness: Math.cos(
				degreesToRadians(plan.angleDegrees + settings.turnDegreesPerSecond * plan.launchSeconds)
			),
			isLaunched: false,
			age: 0,
			speed: 0,
			lean: 0,
			history: []
		};
	}

	const random = createSeededRandom(plan.seed);
	const bobPhase = random() * Math.PI * 2;
	const omega = 2 * Math.PI * SPRING_HERTZ;
	const position = {
		x: plan.launchX,
		y: LAUNCH_Y,
		z: iconOrbitTarget(plan, settings, 0, bobPhase).nearness
	};
	const velocity = {
		x: (random() - 0.5) * 0.15,
		y: -LAUNCH_SPEED * (0.9 + random() * 0.2),
		z: 0
	};
	const history: IconOrbitPoint[] = [{ x: position.x, y: position.y, nearness: position.z }];
	let nextHistory = HISTORY_STEP_SECONDS;
	const steps = Math.floor(age / SIMULATION_STEP_SECONDS);
	for (let step = 1; step <= steps; step += 1) {
		const elapsed = step * SIMULATION_STEP_SECONDS;
		const target = iconOrbitTarget(plan, settings, elapsed, bobPhase);
		const ax = omega * omega * (target.x - position.x) - 2 * SPRING_DAMPING * omega * velocity.x;
		const ay = omega * omega * (target.y - position.y) - 2 * SPRING_DAMPING * omega * velocity.y;
		const az =
			omega * omega * (target.nearness - position.z) - 2 * SPRING_DAMPING * omega * velocity.z;
		velocity.x += ax * SIMULATION_STEP_SECONDS;
		velocity.y += ay * SIMULATION_STEP_SECONDS;
		velocity.z += az * SIMULATION_STEP_SECONDS;
		position.x += velocity.x * SIMULATION_STEP_SECONDS;
		position.y += velocity.y * SIMULATION_STEP_SECONDS;
		position.z += velocity.z * SIMULATION_STEP_SECONDS;
		if (elapsed >= nextHistory - 1e-9) {
			history.push({ x: position.x, y: position.y, nearness: position.z });
			nextHistory += HISTORY_STEP_SECONDS;
		}
	}

	return {
		x: position.x,
		y: position.y,
		nearness: Math.max(-1, Math.min(1, position.z)),
		isLaunched: true,
		age,
		speed: Math.hypot(velocity.x, velocity.y),
		lean: Math.max(-24, Math.min(24, velocity.x * 40)),
		history
	};
}

/** The history point nearest `secondsAfterLaunch`, for particles born along the path. */
export function iconOrbitHistoryAt(
	history: readonly IconOrbitPoint[],
	secondsAfterLaunch: number
): IconOrbitPoint | null {
	if (history.length === 0 || secondsAfterLaunch < 0) return null;
	const index = Math.round(secondsAfterLaunch / HISTORY_STEP_SECONDS);
	return index < history.length ? history[index] : null;
}
