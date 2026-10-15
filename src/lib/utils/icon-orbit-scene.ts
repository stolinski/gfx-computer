import { createSeededRandom } from './seeded';
import {
	iconOrbitHistoryAt,
	resolveIconOrbitFlight,
	type IconOrbitPoint
} from './icon-orbit-flight';

/**
 * Everything one frame of the `icon-orbit` Overlay draws, in frame pixels:
 * each launched icon with its depth styling, the dust it sheds as it floats
 * up, and the slow motes that hang around it once it lands. The renderer only paints
 * what this returns, so the frame is a pure function of the content and time.
 */
export interface IconOrbitSceneIconInput {
	icon: string;
	label?: string;
	launch: number;
	launchX: number;
	angle: number;
	height: number;
}

export interface IconOrbitSceneInput {
	icons: readonly IconOrbitSceneIconInput[];
	pass: 'all' | 'behind' | 'front';
	centerX: number;
	radius: number;
	turnDegreesPerSecond: number;
	tilt: number;
	/** Icon size in cqmin. */
	iconSize: number;
	glow: number;
}

export interface IconOrbitParticle {
	x: number;
	y: number;
	radius: number;
	opacity: number;
}

export interface IconOrbitSceneIcon {
	/** Index into the authored icons, stable across frames. */
	index: number;
	icon: string;
	label?: string;
	x: number;
	y: number;
	/** Rendered icon box size in pixels, after depth. */
	size: number;
	lean: number;
	opacity: number;
	/** Gaussian blur for depth, in the icon's own 120-unit box: icons behind the subject soften. */
	depthBlur: number;
	/** Glow radii in the icon's own 120-unit box: a tight halo and a wide bloom. */
	glowNear: number;
	glowFar: number;
	nearness: number;
	sparks: readonly IconOrbitParticle[];
	motes: readonly IconOrbitParticle[];
}

/** The icon glyphs are drawn in a 120-unit box (-60..60). */
const ICON_BOX_UNITS = 120;
const DEPTH_SCALE = 0.32;
// Fairy dust, not sparks: a few motes shed along the rise that hang in the
// air, drift gently, and twinkle out.
const SPARK_COUNT = 14;
const SPARK_BIRTH_SECONDS = 2.2;
const SPARK_LIFE_SECONDS = 2;
const TWINKLE_HERTZ = 1.6;
const MOTE_COUNT = 6;
const MOTE_FADE_IN_SECONDS = 1.2;

function isInPass(pass: IconOrbitSceneInput['pass'], nearness: number): boolean {
	if (pass === 'all') return true;
	return pass === 'behind' ? nearness < 0 : nearness >= 0;
}

function toPixels(point: IconOrbitPoint, width: number, height: number): { x: number; y: number } {
	return { x: point.x * width, y: point.y * height };
}

/** The ring values every orientation may replace as one unit. */
export interface IconOrbitRingValues {
	centerX: number;
	radius: number;
	tilt: number;
	iconSize: number;
}

/** The ring an orientation films: its own complete snapshot when authored, else the shared ring. */
export function resolveIconOrbitRing(
	shared: IconOrbitRingValues,
	overrides: Partial<Record<'horizontal' | 'vertical', IconOrbitRingValues>> | undefined,
	orientation: 'horizontal' | 'vertical'
): IconOrbitRingValues {
	return overrides?.[orientation] ?? shared;
}

/** One frame of the Overlay at `timeSeconds` into a clip `durationSeconds` long. */
export function resolveIconOrbitScene(
	input: IconOrbitSceneInput,
	timeSeconds: number,
	durationSeconds: number,
	width: number,
	height: number
): IconOrbitSceneIcon[] {
	const cqmin = Math.min(width, height) / 100;
	const settings = {
		centerX: input.centerX,
		radius: input.radius,
		turnDegreesPerSecond: input.turnDegreesPerSecond,
		tilt: input.tilt
	};
	const scene: IconOrbitSceneIcon[] = [];
	input.icons.forEach((authored, index) => {
		const seed = (index + 1) * 0.6180339887 - Math.floor((index + 1) * 0.6180339887);
		const flight = resolveIconOrbitFlight(
			{
				launchSeconds: authored.launch * durationSeconds,
				launchX: authored.launchX,
				angleDegrees: authored.angle,
				height: authored.height,
				seed
			},
			settings,
			timeSeconds
		);
		if (!flight.isLaunched || !isInPass(input.pass, flight.nearness)) return;

		const depth = flight.nearness;
		const size = input.iconSize * cqmin * (1 + DEPTH_SCALE * depth);
		const position = toPixels(flight, width, height);
		const random = createSeededRandom(seed);

		const sparks: IconOrbitParticle[] = [];
		for (let spark = 0; spark < SPARK_COUNT; spark += 1) {
			const born = (spark / SPARK_COUNT) * SPARK_BIRTH_SECONDS;
			const driftX = (random() - 0.5) * 0.03;
			const driftY = (random() - 0.6) * 0.025;
			const sparkRadius = (0.1 + random() * 0.16) * cqmin;
			const twinklePhase = random() * Math.PI * 2;
			const life = flight.age - born;
			if (life < 0 || life > SPARK_LIFE_SECONDS) continue;
			const origin = iconOrbitHistoryAt(flight.history, born);
			if (!origin) continue;
			const fade = Math.sin(Math.PI * (life / SPARK_LIFE_SECONDS));
			const twinkle = 0.55 + 0.45 * Math.sin(2 * Math.PI * TWINKLE_HERTZ * life + twinklePhase);
			sparks.push({
				x: (origin.x + driftX * life) * width,
				y: (origin.y + driftY * life) * height,
				radius: sparkRadius,
				opacity: 0.8 * fade * twinkle
			});
		}

		const motes: IconOrbitParticle[] = [];
		const moteFade = Math.min(1, Math.max(0, (flight.age - 0.8) / MOTE_FADE_IN_SECONDS));
		if (moteFade > 0) {
			for (let mote = 0; mote < MOTE_COUNT; mote += 1) {
				const orbit = size * (0.55 + random() * 0.5);
				const phase = random() * Math.PI * 2;
				const spin = (0.25 + random() * 0.35) * (random() < 0.5 ? -1 : 1);
				const angle = phase + spin * flight.age;
				motes.push({
					x: position.x + Math.cos(angle) * orbit,
					y: position.y + Math.sin(angle) * orbit * 0.55,
					radius: (0.18 + random() * 0.25) * cqmin,
					opacity: 0.35 * moteFade
				});
			}
		}

		scene.push({
			index,
			icon: authored.icon,
			label: authored.label,
			x: position.x,
			y: position.y,
			size,
			lean: flight.lean,
			opacity: 0.68 + 0.32 * ((depth + 1) / 2),
			depthBlur: (Math.max(0, -depth) * 0.6 * cqmin * ICON_BOX_UNITS) / size,
			glowNear: 4 * input.glow,
			glowFar: 13 * input.glow,
			nearness: depth,
			sparks,
			motes
		});
	});
	// Far icons first, so nearer ones paint over them.
	return scene.sort((left, right) => left.nearness - right.nearness);
}
