/**
 * Derived sound cues (ADR-0033 §2, §4). Motion primitives emit semantic sound
 * events at their own frame — automatic cues are a pure function of the
 * composition's motion, DERIVED here at render time and never stored in
 * `audioCues[]`, so they stay welded to the motion through every re-time and
 * reflow. Consumers: the offline export mix, the playback-only preview
 * scheduler, and the timeline's audio-cue rail. Pure / deterministic — no
 * Svelte, no DOM.
 */
import { messageEnter, TAPBACK_DELAY } from '../pipelines/surfaces/imessage/schedule.ts';
import { TEXT_EFFECT_CATALOG } from '../text-animations/catalog.ts';
import {
	isAchievementVariantId,
	VARIANTS as ACHIEVEMENT_VARIANTS
} from '../pipelines/overlays/achievement/variants/index.ts';

import { resolveCascadeTimings, type CascadeWindow } from './cascade-timing.ts';
import {
	resolveMarkForIndex,
	type ChatMessage,
	type EngineState,
	type MarkInstance,
	type OverlayChannelKeyframes,
	type SoundEvent,
	type SoundOverride
} from './engine-schema.ts';
import { listSurfaceMarkInstances } from './surface-mark-instances.ts';
import { resolveOrientationKeyframeChannels } from '../utils/orientation-keyframe-channels.ts';

/** The Layer that emitted a cue — provenance for the rail and cue inspector. */
export type SoundCueLayer =
	| { kind: 'surface' }
	| { kind: 'marks' }
	| { kind: 'overlay'; overlayId: string }
	| { kind: 'block'; blockId: string };

export type DerivedSoundCueEditTarget =
	| { kind: 'surface-transition'; phase: 'enter' | 'exit' }
	| { kind: 'mark-transition'; markIndex: number }
	| { kind: 'checklist-item-strike'; itemIndex: number }
	| { kind: 'overlay-transition'; overlayId: string; phase: 'enter' | 'exit' }
	| { kind: 'block-transition'; blockId: string; phase: 'enter' }
	| {
			kind: 'text-animation-transition';
			textAnimationId: string;
			phase: 'enter' | 'exit';
	  }
	| { kind: 'surface-message-transition'; messageIndex: number };

export type DerivedSoundCueSource =
	| DerivedSoundCueEditTarget
	| { kind: 'surface-message-tapback'; messageIndex: number }
	| { kind: 'overlay-beat'; overlayId: string; beat: 'press' | 'achievement' };

export interface DerivedSoundCue {
	/** Stable per-motion-beat id, e.g. `surface:enter`, `overlay:badge:exit`, `mark:2`. */
	id: string;
	layer: SoundCueLayer;
	/** Structured motion provenance; never inferred by splitting the opaque cue id. */
	source: DerivedSoundCueSource;
	/** Live schema window the inspector may edit, or null for locked/default-only beats. */
	editTarget: DerivedSoundCueEditTarget | null;
	event: SoundEvent;
	/** Timeline fraction — the motion's own frame. */
	start: number;
	/** Locked audio-asset slug from the per-motion override — replaces the event's default sample. */
	sample?: string;
	muted: boolean;
}

/**
 * Default primitive → event mapping (ADR-0033 §2, §8). The per-motion
 * `sound.event` override swaps an individual motion away from these.
 * Per-character text effects tick (the kinetic-build sound); received chat
 * bubbles pop and sent ones swish away; everything else whooshes in/out with
 * its window.
 */
export const MOTION_SOUND_DEFAULTS = {
	surfaceEnter: 'whoosh-in',
	surfaceExit: 'whoosh-out',
	overlayEnter: 'whoosh-in',
	overlayExit: 'whoosh-out',
	textEnter: 'whoosh-in',
	textEnterPerCharacter: 'tick',
	textExit: 'whoosh-out',
	mark: 'tick',
	message: 'pop',
	messageReply: 'send'
} as const satisfies Record<string, SoundEvent>;

/**
 * The engine's default sample per sound event — THE sound model (the retired
 * per-Layer bundle concept was removed 2026-07-02 after GUI testing because it
 * made "what does this play" illegible; see ADR-0033 amendments). Every
 * motion resolves motion → event → this table, and any individual cue is
 * overridden per motion (`sound.sample` / `sound.mute`) from the timeline or
 * inspector. Slugs into `audio-assets.ts`.
 */
export const DEFAULT_EVENT_SAMPLES: Record<SoundEvent, string> = {
	'whoosh-in': 'foley-swoosh',
	'whoosh-out': 'foley-whoosh',
	impact: 'foley-drop',
	tick: 'foley-tick',
	click: 'foley-tap',
	pop: 'foley-pop',
	send: 'foley-swoosh',
	swipe: 'foley-whoosh',
	scratch: 'foley-glide',
	draw: 'foley-rise',
	'sub-drop': 'foley-latch',
	sting: 'foley-complete'
};

/**
 * Resolve a derived cue to the audio-asset slug it plays, or null for
 * silence: per-motion override first (`sample` lock / `mute`), else the
 * event's engine default.
 */
export function resolveCueSample(cue: DerivedSoundCue): string | null {
	if (cue.muted) {
		return null;
	}
	return cue.sample ?? DEFAULT_EVENT_SAMPLES[cue.event];
}

// Arrival-flavoured events mark a landing, not a launch — they fire at the
// window's settle (start + duration), the "impact at a card-drop's settle" of
// ADR-0033 §2. Everything else leads the motion from its window start.
const ARRIVAL_EVENTS: ReadonlySet<SoundEvent> = new Set(['impact', 'sub-drop']);

// Motion-character defaults per Overlay type (ADR-0033 §2: WHICH event is
// intrinsic to the motion, owned by the Pipeline). A whoosh means something
// crossing space — types whose motion doesn't displace air (a press-on, a
// fade, a glide) emit NOTHING by default; their sound is opt-in per motion
// through the `sound.event` / `sound.sample` override. Unlisted types keep
// the generic slide semantics (whoosh with the window).
const OVERLAY_EVENT_DEFAULTS: Record<
	string,
	{ enter: SoundEvent | null; exit: SoundEvent | null }
> = {
	// Tape is pressed on / peeled off — nothing flies.
	'washi-tape': { enter: null, exit: null },
	// A watermark fades — silent.
	watermark: { enter: null, exit: null },
	// The cursor glides; its dwells are the story, not air displacement.
	'cursor-trail': { enter: null, exit: null }
};

// The iMessage bubble arrivals — locked-specific signature sounds (ADR-0033
// §5), like the tapbacks below. The real Apple recordings belong to the chat
// surface ONLY; the general `pop` / `send` events resolve through
// DEFAULT_EVENT_SAMPLES
// (dex gmrkycs6 — the Messages bloop had leaked onto every pop in the
// vocabulary, diagram nodes included).
export const MESSAGE_SAMPLES = {
	received: 'message-pop',
	sent: 'message-send'
} as const;

// The iMessage tapback acknowledgements — locked-specific signature sounds
// per reaction type (ADR-0033 §5), resolved directly to bundled assets
// (events carry one default sample; tapbacks are per type).
export const TAPBACK_SAMPLES: Record<NonNullable<ChatMessage['tapback']>, string> = {
	heart: 'tapback-heart',
	like: 'tapback-like',
	dislike: 'tapback-dislike',
	haha: 'tapback-haha',
	emphasize: 'tapback-emphasize',
	question: 'tapback-question'
};

// Per-style mark draw-on events (the motion-character rule for the
// annotation Layer): a highlight is a marker DRAG (swipe), the stroked marks
// are pen/pencil strokes (scratch), and the focal transforms keep the small
// percussive tick.
const MARK_EVENT_DEFAULTS: Record<MarkInstance['style'], SoundEvent> = {
	highlight: 'swipe',
	underline: 'scratch',
	strike: 'scratch',
	circle: 'scratch',
	box: 'scratch',
	'side-note': 'scratch',
	magnify: 'tick',
	'lift-out': 'tick',
	'tear-out': 'tick',
	isolate: 'tick'
};

// Text-animation effects whose motion is a FADE (opacity/blur in place, no
// travel) — silent by default, same rule as the tables below. Travel and
// per-character effects keep their whoosh/tick defaults.
const FADE_TEXT_EFFECTS: ReadonlySet<string> = new Set([
	'fade-through',
	'per-word-crossfade',
	'micro-scale-fade',
	'scale-down-fade',
	'focus-blur-resolve',
	'soft-blur-in'
]);

// Same principle for Surface types: a surface whose enter/exit is a FADE
// (opacity, not travel) emits nothing by default — only surfaces that fly or
// slide whoosh. Unlisted types keep the fly-in card semantics.
const SURFACE_EVENT_DEFAULTS: Record<
	string,
	{ enter: SoundEvent | null; exit: SoundEvent | null }
> = {
	// The chat card fades in; its bubbles carry the sound (pop per message).
	imessage: { enter: null, exit: null },
	// The chapter card fades on the GPU (paperVisibility); the camera push is
	// ambience, not displacement — the bed and the title reveal carry it.
	'chapter-card': { enter: null, exit: null }
};

interface MotionWindow {
	start: number;
	duration: number;
}

// Whether an authored channel set moves the element through space (x/y travel,
// scale, rotation) or only fades it (opacity alone). Extends the ADR-0033 §2
// motion-character rule to the keyframe model: travel whooshes, a pure fade is
// silent by default.
function channelsTravel(channels: OverlayChannelKeyframes): boolean {
	return Boolean(
		channels.x?.length || channels.y?.length || channels.scale?.length || channels.rotation?.length
	);
}

function hasChannelMotion(
	channels: Partial<Record<string, readonly { atMs: number }[] | undefined>> | undefined
): boolean {
	if (!channels) {
		return false;
	}
	return Object.values(channels).some((track) => track !== undefined && track.length > 0);
}

function cueFrom(
	id: string,
	layer: SoundCueLayer,
	defaultEvent: SoundEvent,
	window: MotionWindow,
	override: SoundOverride | undefined,
	source: DerivedSoundCueSource,
	editTarget: DerivedSoundCueEditTarget | null
): DerivedSoundCue {
	const event = override?.event ?? defaultEvent;
	const start = ARRIVAL_EVENTS.has(event)
		? Math.min(1, window.start + window.duration)
		: window.start;

	const cue: DerivedSoundCue = {
		id,
		layer,
		source,
		editTarget,
		event,
		start,
		muted: override?.mute === true
	};
	if (override?.sample !== undefined) {
		cue.sample = override.sample;
	}
	return cue;
}

// A silent-by-character motion (default event null) emits only when the
// author opts in with an explicit event swap or a locked sample.
function hasSoundOptIn(override: SoundOverride | undefined): boolean {
	return Boolean(override?.event) || override?.sample !== undefined;
}

type CascadeWindowMap = ReadonlyMap<string, CascadeWindow>;

// Cascade welds anchor the ENTER start; the authored duration is kept.
function resolveEnterWindow(
	cascadeWindows: CascadeWindowMap,
	key: string,
	authored: MotionWindow
): MotionWindow {
	const resolved = cascadeWindows.get(key);
	return resolved ? { start: resolved.startFraction, duration: authored.duration } : authored;
}

function deriveSurfaceTransitionCues(
	surface: EngineState['surface'],
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	const surfaceLayer: SoundCueLayer = { kind: 'surface' };

	if (hasChannelMotion(surface.animation?.channels)) {
		// Channel-owned surface (opacity is its only channel — a fade): silent by
		// default per the motion-character rule; the sugar `enter.sound` override
		// stays the opt-in home. The window is the authored envelope.
		const override = surface.enter?.sound;
		if (hasSoundOptIn(override)) {
			const resolved = cascadeWindows.get('surface');
			cues.push(
				cueFrom(
					'surface:enter',
					surfaceLayer,
					MOTION_SOUND_DEFAULTS.surfaceEnter,
					{
						start: resolved?.startFraction ?? surface.enter?.start ?? 0,
						duration: resolved?.durationFraction ?? 0
					},
					override,
					{ kind: 'surface-transition', phase: 'enter' },
					{ kind: 'surface-transition', phase: 'enter' }
				)
			);
		}
		return;
	}

	const surfaceTypeDefaults = SURFACE_EVENT_DEFAULTS[surface.type];
	for (const phase of ['enter', 'exit'] as const) {
		const motionWindow = surface[phase];
		if (!motionWindow) {
			continue;
		}
		const genericDefault =
			phase === 'enter' ? MOTION_SOUND_DEFAULTS.surfaceEnter : MOTION_SOUND_DEFAULTS.surfaceExit;
		const typeDefault =
			surfaceTypeDefaults === undefined ? genericDefault : surfaceTypeDefaults[phase];
		const override = motionWindow.sound;
		// A fade-type surface emits only when the author opts in explicitly.
		if (typeDefault === null && !hasSoundOptIn(override)) {
			continue;
		}
		cues.push(
			cueFrom(
				`surface:${phase}`,
				surfaceLayer,
				typeDefault ?? genericDefault,
				motionWindow,
				override,
				{ kind: 'surface-transition', phase },
				{ kind: 'surface-transition', phase }
			)
		);
	}
}

// One cue per mark instance, indexed like `marks.timings[]` (document
// order); `resolveMarkForIndex` supplies the draw-on window even when the
// timing entry is absent (shared fallback timing). Checklist item strikes
// (ADR-0040) carry their window ON the instance: a static strike has no
// motion and emits nothing; an animated one sounds at its own window with
// the item's override — marks.timings[] is never consulted for them.
function deriveMarkCues(
	state: EngineState,
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	listSurfaceMarkInstances(state.surface).forEach((instance, index) => {
		if (instance.window === 'static') {
			return;
		}
		if (instance.window !== undefined) {
			if (instance.itemIndex === undefined) {
				throw new Error('Derived sound cue: checklist item strike is missing its item index.');
			}
			const target: DerivedSoundCueEditTarget = {
				kind: 'checklist-item-strike',
				itemIndex: instance.itemIndex
			};
			cues.push(
				cueFrom(
					`mark:${index}`,
					{ kind: 'marks' },
					MARK_EVENT_DEFAULTS[instance.style] ?? MOTION_SOUND_DEFAULTS.mark,
					instance.window,
					instance.sound,
					target,
					target
				)
			);
			return;
		}
		const resolved = resolveMarkForIndex(instance.style, index, state.marks);
		cues.push(
			cueFrom(
				`mark:${index}`,
				{ kind: 'marks' },
				MARK_EVENT_DEFAULTS[instance.style] ?? MOTION_SOUND_DEFAULTS.mark,
				resolveEnterWindow(cascadeWindows, `mark:${index}`, resolved),
				state.marks.timings[index]?.sound,
				{ kind: 'mark-transition', markIndex: index },
				{ kind: 'mark-transition', markIndex: index }
			)
		);
	});
}

// Channel-owned overlay (ADR-0035): ONE motion beat — the enter
// envelope. Enter-family events fire at the resolved clip start;
// arrival events (via cueFrom) at the envelope's landing keyframe.
// There is no discrete exit window — an authored fade-out is part of
// the envelope, not a second launch. Character rule: travel channels
// whoosh, an opacity-only fade is silent by default; a silent-by-type
// Pipeline stays silent. The sugar `enter.sound` is the override home.
function deriveChannelOverlayCue(
	overlay: EngineState['overlays'][number],
	typeDefaults: { enter: SoundEvent | null; exit: SoundEvent | null } | undefined,
	channels: OverlayChannelKeyframes,
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	const characterDefault =
		typeDefaults !== undefined
			? typeDefaults.enter
			: channelsTravel(channels)
				? MOTION_SOUND_DEFAULTS.overlayEnter
				: null;
	const override = overlay.enter?.sound;
	if (characterDefault === null && !hasSoundOptIn(override)) {
		return;
	}
	const resolved = cascadeWindows.get(`overlay:${overlay.id}`);
	cues.push(
		cueFrom(
			`overlay:${overlay.id}:enter`,
			{ kind: 'overlay', overlayId: overlay.id },
			characterDefault ?? MOTION_SOUND_DEFAULTS.overlayEnter,
			{
				start: resolved?.startFraction ?? overlay.enter?.start ?? 0,
				duration: resolved?.durationFraction ?? 0
			},
			override,
			{ kind: 'overlay-transition', overlayId: overlay.id, phase: 'enter' },
			{ kind: 'overlay-transition', overlayId: overlay.id, phase: 'enter' }
		)
	);
}

function deriveOverlayTransitionCues(
	overlays: EngineState['overlays'],
	orientation: EngineState['transport']['orientation'],
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	for (const overlay of overlays) {
		const layer: SoundCueLayer = { kind: 'overlay', overlayId: overlay.id };
		const typeDefaults = OVERLAY_EVENT_DEFAULTS[overlay.type];
		const channels: OverlayChannelKeyframes = resolveOrientationKeyframeChannels(
			overlay.animation,
			orientation
		);

		if (channels && hasChannelMotion(channels)) {
			deriveChannelOverlayCue(overlay, typeDefaults, channels, cascadeWindows, cues);
			continue;
		}

		for (const phase of ['enter', 'exit'] as const) {
			const motionWindow = overlay[phase];
			if (!motionWindow) {
				continue;
			}
			const genericDefault =
				phase === 'enter' ? MOTION_SOUND_DEFAULTS.overlayEnter : MOTION_SOUND_DEFAULTS.overlayExit;
			const typeDefault = typeDefaults === undefined ? genericDefault : typeDefaults[phase];
			const override = motionWindow.sound;
			if (typeDefault === null && !hasSoundOptIn(override)) {
				continue;
			}
			cues.push(
				cueFrom(
					`overlay:${overlay.id}:${phase}`,
					layer,
					typeDefault ?? genericDefault,
					// Cascade welds anchor the ENTER start; exits keep authored timing.
					phase === 'enter'
						? resolveEnterWindow(cascadeWindows, `overlay:${overlay.id}`, motionWindow)
						: motionWindow,
					override,
					{ kind: 'overlay-transition', overlayId: overlay.id, phase },
					{ kind: 'overlay-transition', overlayId: overlay.id, phase }
				)
			);
		}
	}
}

type DiagramPrimitive = NonNullable<EngineState['surface']['diagram']>[number];

// Intrinsic enter character per diagram primitive type: the stroke draw-ons
// are clean line draws, a node PLANTS with its scale-settle; everything else
// (label rises, the stat roll) is silent by default.
function diagramBlockEnterDefault(type: DiagramPrimitive['type']): SoundEvent | null {
	if (type === 'edge-arrow' || type === 'timeline-segment') {
		return 'draw';
	}
	return type === 'node' ? 'pop' : null;
}

function pushDiagramBlockCue(
	primitive: DiagramPrimitive,
	defaultEvent: SoundEvent,
	window: MotionWindow,
	cues: DerivedSoundCue[]
): void {
	const target: DerivedSoundCueEditTarget = {
		kind: 'block-transition',
		blockId: primitive.id,
		phase: 'enter'
	};
	cues.push(
		cueFrom(
			`block:${primitive.id}:enter`,
			{ kind: 'block', blockId: primitive.id },
			defaultEvent,
			window,
			primitive.enter?.sound,
			target,
			primitive.enter ? target : null
		)
	);
}

// Channel-owned primitives get the one enter beat, silent unless the channels
// travel.
function deriveChannelBlockCue(
	primitive: DiagramPrimitive,
	enterDefault: SoundEvent | null,
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	const channels = primitive.animation?.channels;
	const characterDefault =
		channels && channelsTravel(channels as OverlayChannelKeyframes)
			? (enterDefault ?? MOTION_SOUND_DEFAULTS.overlayEnter)
			: null;
	if (characterDefault === null && !hasSoundOptIn(primitive.enter?.sound)) {
		return;
	}
	const resolved = cascadeWindows.get(`block:${primitive.id}`);
	pushDiagramBlockCue(
		primitive,
		characterDefault ?? MOTION_SOUND_DEFAULTS.overlayEnter,
		{
			start: resolved?.startFraction ?? primitive.enter?.start ?? 0,
			duration: resolved?.durationFraction ?? 0
		},
		cues
	);
}

// Diagram primitive Blocks (ADR-0036 + the ADR-0033 motion-character rule):
// the stroke draw-ons are clean line draws (`draw` — a technical canvas,
// not the annotation Layer's hand pencil); a node PLANTS with its
// scale-settle (pop); label rises and the stat roll are silent by default —
// their sound is opt-in via the enter override. Exits are fades everywhere
// (silent). Channel-owned primitives get the one enter beat, silent unless
// the channels travel.
function deriveDiagramBlockCues(
	diagram: EngineState['surface']['diagram'],
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	for (const primitive of diagram ?? []) {
		const enterDefault = diagramBlockEnterDefault(primitive.type);
		if (hasChannelMotion(primitive.animation?.channels)) {
			deriveChannelBlockCue(primitive, enterDefault, cascadeWindows, cues);
			continue;
		}

		if (enterDefault === null && !hasSoundOptIn(primitive.enter?.sound)) {
			continue;
		}
		const resolved = cascadeWindows.get(`block:${primitive.id}`);
		pushDiagramBlockCue(
			primitive,
			enterDefault ?? MOTION_SOUND_DEFAULTS.overlayEnter,
			{
				start: resolved?.startFraction ?? primitive.enter?.start ?? 0,
				duration: resolved?.durationFraction ?? primitive.enter?.duration ?? 0
			},
			cues
		);
	}
}

// Platform-CTA press beats (creator blocks): the youtube-subscribe and
// instagram-follow presses emit a CLICK at their authored `beat` — a
// button press, not a bubble arrival (its own event so the character is
// honest and per-motion overrides read right). The beat has no Transition
// window (it is content, like the counter's roll), so the cue carries the
// default sample; the rail shows it like every derived cue.
function derivePlatformPressCues(overlays: EngineState['overlays'], cues: DerivedSoundCue[]): void {
	for (const overlay of overlays) {
		if (overlay.type !== 'youtube-subscribe' && overlay.type !== 'instagram-follow') {
			continue;
		}
		const content = overlay.content as { beat?: number } | null;
		cues.push(
			cueFrom(
				`overlay:${overlay.id}:beat`,
				{ kind: 'overlay', overlayId: overlay.id },
				'click',
				{ start: content?.beat ?? 0.42, duration: 0 },
				undefined,
				{ kind: 'overlay-beat', overlayId: overlay.id, beat: 'press' },
				null
			)
		);
	}
}

// Achievement focal events are intrinsic to each data variant and keyed to
// the same authored beat as the pixels and timeline clip. Checklist draws,
// then lands with a restrained click; unlocked emits one compact pop.
function deriveAchievementBeatCues(
	overlays: EngineState['overlays'],
	durationSeconds: number,
	cues: DerivedSoundCue[]
): void {
	for (const overlay of overlays) {
		if (overlay.type !== 'achievement') {
			continue;
		}
		const content = overlay.content as { variant?: string; beat?: number } | null;
		const variantId = content?.variant ?? 'checklist-complete';
		if (!isAchievementVariantId(variantId)) {
			continue;
		}
		const beat = content?.beat ?? 0.3375;
		for (const sound of ACHIEVEMENT_VARIANTS[variantId].soundEvents) {
			cues.push(
				cueFrom(
					`overlay:${overlay.id}:beat-${sound.event}`,
					{ kind: 'overlay', overlayId: overlay.id },
					sound.event,
					{
						start: Math.max(0, Math.min(1, beat + sound.offsetMs / (durationSeconds * 1000))),
						duration: 0
					},
					undefined,
					{ kind: 'overlay-beat', overlayId: overlay.id, beat: 'achievement' },
					null
				)
			);
		}
	}
}

// Text animations attribute to their TARGET Layer. Per-character effects
// tick; whole/word/line travel effects whoosh with their window;
// fade-family effects are silent (the same motion-character rule as the
// overlay/surface tables above).
function deriveTextAnimationCues(
	textAnimations: EngineState['textAnimations'],
	cascadeWindows: CascadeWindowMap,
	cues: DerivedSoundCue[]
): void {
	for (const entry of textAnimations) {
		const layer: SoundCueLayer =
			entry.target.kind === 'overlay'
				? { kind: 'overlay', overlayId: entry.target.overlayId }
				: { kind: 'surface' };

		const spec = TEXT_EFFECT_CATALOG.get(entry.effect);
		const isFade = FADE_TEXT_EFFECTS.has(entry.effect);
		const enterDefault = isFade
			? null
			: spec?.target === 'per-character'
				? MOTION_SOUND_DEFAULTS.textEnterPerCharacter
				: MOTION_SOUND_DEFAULTS.textEnter;

		for (const phase of ['enter', 'exit'] as const) {
			const motionWindow = entry[phase];
			if (!motionWindow) {
				continue;
			}
			const typeDefault =
				phase === 'enter' ? enterDefault : isFade ? null : MOTION_SOUND_DEFAULTS.textExit;
			const override = motionWindow.sound;
			if (typeDefault === null && !hasSoundOptIn(override)) {
				continue;
			}
			cues.push(
				cueFrom(
					`text:${entry.id}:${phase}`,
					layer,
					typeDefault ??
						(phase === 'enter' ? MOTION_SOUND_DEFAULTS.textEnter : MOTION_SOUND_DEFAULTS.textExit),
					// Cascade welds anchor the ENTER start; exits keep authored timing.
					phase === 'enter'
						? resolveEnterWindow(cascadeWindows, `textAnimation:${entry.id}`, motionWindow)
						: motionWindow,
					override,
					{
						kind: 'text-animation-transition',
						textAnimationId: entry.id,
						phase
					},
					{
						kind: 'text-animation-transition',
						textAnimationId: entry.id,
						phase
					}
				)
			);
		}
	}
}

// Chat bubbles sound on the `imessage` Surface (every other Surface ignores
// `content.messages`): received bubbles pop, sent bubbles play the send
// swish — the side IS the motion character, and each side locks its Apple
// signature sample (MESSAGE_SAMPLES) unless the author re-voices the bubble
// with an explicit event swap or sample lock. Bubbles without an explicit
// `enter` still sound — the default staggered cadence is composition
// timing too.
function deriveChatMessageCues(surface: EngineState['surface'], cues: DerivedSoundCue[]): void {
	if (surface.type !== 'imessage') {
		return;
	}
	const surfaceLayer: SoundCueLayer = { kind: 'surface' };
	(surface.content.messages ?? []).forEach((message, index) => {
		const enter = messageEnter(message, index);
		const override = message.enter?.sound;
		const signature = message.from === 'me' ? MESSAGE_SAMPLES.sent : MESSAGE_SAMPLES.received;
		cues.push(
			cueFrom(
				`message:${index}`,
				surfaceLayer,
				message.from === 'me' ? MOTION_SOUND_DEFAULTS.messageReply : MOTION_SOUND_DEFAULTS.message,
				enter,
				hasSoundOptIn(override) ? override : { ...override, sample: signature },
				{ kind: 'surface-message-transition', messageIndex: index },
				message.enter ? { kind: 'surface-message-transition', messageIndex: index } : null
			)
		);

		// A tapback lands TAPBACK_DELAY after its bubble with its per-type
		// acknowledgement — a locked-specific signature sound (ADR-0033 §5).
		if (message.tapback) {
			cues.push(
				cueFrom(
					`message:${index}:tapback`,
					surfaceLayer,
					MOTION_SOUND_DEFAULTS.message,
					{ start: enter.start + TAPBACK_DELAY, duration: 0 },
					{ sample: TAPBACK_SAMPLES[message.tapback] },
					{ kind: 'surface-message-tapback', messageIndex: index },
					null
				)
			);
		}
	});
}

/**
 * Every automatic cue the composition's motion emits, sorted by time. Includes
 * muted cues so the GUI rail can show them; audible
 * consumers filter with {@link isAudibleSoundCue}. Manual cues and the bed
 * live in `state.audioCues[]` and are NOT returned here — the mix combines
 * both.
 */
export function deriveSoundCues(state: EngineState): DerivedSoundCue[] {
	const cues: DerivedSoundCue[] = [];

	// Cues resolve AFTER cascade resolution (ADR-0035 §4 + ADR-0033): automatic
	// cues ride a re-timed cascade welded — same philosophy, one mechanism. The
	// resolved windows also carry the keyframe envelope for channel-owned
	// elements (first keyframe → landing).
	const cascadeWindows = resolveCascadeTimings(state);

	deriveSurfaceTransitionCues(state.surface, cascadeWindows, cues);
	deriveMarkCues(state, cascadeWindows, cues);
	deriveOverlayTransitionCues(state.overlays, state.transport.orientation, cascadeWindows, cues);
	deriveDiagramBlockCues(state.surface.diagram, cascadeWindows, cues);
	derivePlatformPressCues(state.overlays, cues);
	deriveAchievementBeatCues(state.overlays, state.transport.durationSeconds, cues);
	deriveTextAnimationCues(state.textAnimations, cascadeWindows, cues);
	deriveChatMessageCues(state.surface, cues);

	return cues.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/**
 * Whether a derived cue produces sound. Every derived cue carries an engine
 * default; only a per-motion mute silences it (silent-by-character motions
 * never emit a cue at all).
 */
export function isAudibleSoundCue(cue: DerivedSoundCue): boolean {
	return !cue.muted;
}
