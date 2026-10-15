import { evaluateNamedEase } from '$lib/utils/ease-curves';
import { hashStringToUnitInterval } from '$lib/utils/seeded';
import {
	MULTIPLAYER_SESSION_USER_COLORS,
	type MultiplayerSessionContent,
	type MultiplayerSessionEvent,
	type MultiplayerSessionLayout
} from '$lib/pipelines/overlays/multiplayer-session/definition';

// A Multiplayer Session is laid out here, in frame pixels, rather than by the
// browser: the cursors have to land on a caret, a send button, or a fork card,
// so every box's place is computed from the content and the time, and the
// renderer only draws what this returns. Every value is a pure function of
// time, so preview and export agree.

/** Monospace advance as a fraction of the font size; the prompt and log are set in a mono face. */
const MONO_ADVANCE = 0.6;
const LINE_HEIGHT = 1.55;
const ENTRY_GROW_SECONDS = 0.35;
const CURSOR_TRAVEL_SECONDS = 0.7;
const CURSOR_JOIN_SECONDS = 1.1;
const CLICK_SECONDS = 0.45;
const FORK_POP_SECONDS = 0.5;
const AVATAR_POP_SECONDS = 0.4;

export interface MultiplayerSessionSizes {
	textSize: number;
	titleSize: number;
	nameSize: number;
	cursorSize: number;
	paddingX: number;
	paddingY: number;
	gap: number;
	radius: number;
}

export interface MultiplayerSessionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type MultiplayerSessionLogEntry =
	| {
			key: string;
			kind: 'message';
			rect: MultiplayerSessionRect;
			opacity: number;
			name: string;
			color: string;
			text: string;
			tag?: string;
	  }
	| {
			key: string;
			kind: 'step';
			rect: MultiplayerSessionRect;
			opacity: number;
			tool: string;
			text: string;
			isDone: boolean;
	  }
	| { key: string; kind: 'fork'; rect: MultiplayerSessionRect; opacity: number; text: string }
	| {
			key: string;
			kind: 'wait';
			rect: MultiplayerSessionRect;
			opacity: number;
			text: string;
			timer?: string;
	  };

export interface MultiplayerSessionPromptRow {
	userId: string;
	color: string;
	text: string;
	isTyping: boolean;
	textX: number;
	centerY: number;
}

export interface MultiplayerSessionFork {
	key: string;
	label: string;
	detail?: string;
	rect: MultiplayerSessionRect;
	pop: number;
	/** SVG path from the window edge to the card. */
	connector: string;
}

export interface MultiplayerSessionAvatar {
	userId: string;
	initial: string;
	color: string;
	x: number;
	y: number;
	size: number;
	pop: number;
}

export interface MultiplayerSessionCursor {
	userId: string;
	name: string;
	color: string;
	x: number;
	y: number;
	opacity: number;
	/** 0 → no click; otherwise the click ring's progress. */
	click: number;
	status?: string;
}

export interface MultiplayerSessionScene {
	unit: number;
	window: MultiplayerSessionRect & { headerHeight: number };
	status: { isWaiting: boolean; label: string; x: number; centerY: number };
	avatars: MultiplayerSessionAvatar[];
	log: MultiplayerSessionLogEntry[];
	logViewport: MultiplayerSessionRect;
	prompt: MultiplayerSessionRect & {
		rows: MultiplayerSessionPromptRow[];
		send: { x: number; y: number; size: number; press: number };
	};
	forks: MultiplayerSessionFork[];
	cursors: MultiplayerSessionCursor[];
}

/** The window layout one orientation shows: its own snapshot when customized, else the shared one. */
export function resolveMultiplayerSessionLayout(
	shared: MultiplayerSessionLayout,
	overrides: MultiplayerSessionContent['orientationOverrides'],
	orientation: 'horizontal' | 'vertical'
): MultiplayerSessionLayout {
	return overrides?.[orientation] ?? shared;
}

export function resolveMultiplayerSessionUserColor(
	content: Pick<MultiplayerSessionContent, 'users'>,
	userId: string
): string {
	const index = content.users.findIndex((user) => user.id === userId);
	const user = content.users[index];
	return (
		user?.color ??
		MULTIPLAYER_SESSION_USER_COLORS[Math.max(0, index) % MULTIPLAYER_SESSION_USER_COLORS.length]
	);
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function smooth(progress: number): number {
	return evaluateNamedEase('smooth', clamp01(progress));
}

function settled(progress: number): number {
	return evaluateNamedEase('settled', clamp01(progress));
}

/** A spring-like pop that overshoots a little before resting at 1. */
function pop(progress: number): number {
	const p = clamp01(progress);
	if (p === 0) return 0;
	return 1 + Math.exp(-6 * p) * Math.sin(p * Math.PI * 2.4 - Math.PI / 2) * 1;
}

export function formatMultiplayerSessionTimer(seconds: number): string {
	const whole = Math.max(0, Math.ceil(seconds));
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

interface TimedEvent<K extends MultiplayerSessionEvent['kind']> {
	event: Extract<MultiplayerSessionEvent, { kind: K }>;
	index: number;
	seconds: number;
}

function eventsOfKind<K extends MultiplayerSessionEvent['kind']>(
	events: readonly MultiplayerSessionEvent[],
	kind: K,
	durationSeconds: number
): TimedEvent<K>[] {
	return events
		.map((event, index) => ({ event, index, seconds: event.at * durationSeconds }))
		.filter((item): item is TimedEvent<K> => item.event.kind === kind)
		.sort((a, b) => a.seconds - b.seconds);
}

interface CursorWaypoint {
	start: number;
	travel: number;
	target: (seconds: number) => { x: number; y: number };
}

function cursorPosition(
	waypoints: readonly CursorWaypoint[],
	index: number,
	seconds: number
): { x: number; y: number } {
	const waypoint = waypoints[index];
	const target = waypoint.target(seconds);
	if (index === 0) return target;
	const from = cursorPosition(waypoints, index - 1, waypoint.start);
	const progress = smooth((seconds - waypoint.start) / waypoint.travel);
	return { x: from.x + (target.x - from.x) * progress, y: from.y + (target.y - from.y) * progress };
}

export function resolveMultiplayerSessionScene(
	content: MultiplayerSessionContent,
	layout: MultiplayerSessionLayout,
	sizes: MultiplayerSessionSizes,
	seconds: number,
	durationSeconds: number,
	frameWidth: number,
	frameHeight: number
): MultiplayerSessionScene {
	const unit = Math.min(frameWidth, frameHeight) / 100;
	const text = sizes.textSize * unit;
	const lineHeight = text * LINE_HEIGHT;
	const padX = sizes.paddingX * unit;
	const padY = sizes.paddingY * unit;
	const gap = sizes.gap * unit;
	const at = (fraction: number): number => fraction * durationSeconds;

	const win = {
		x: layout.x * frameWidth,
		y: layout.y * frameHeight,
		width: layout.width * frameWidth,
		height: layout.height * frameHeight,
		headerHeight: sizes.titleSize * unit * 1.4 + padY * 2
	};

	const users = content.users;
	const colorOf = (userId: string): string => resolveMultiplayerSessionUserColor(content, userId);
	const nameOf = (userId: string): string =>
		users.find((user) => user.id === userId)?.name ?? userId;

	// ---------------------------------------------------------------- prompt
	const rowCount = users.length;
	const promptHeight = rowCount * lineHeight + gap * 2;
	const prompt = {
		x: win.x + padX,
		y: win.y + win.height - padY - promptHeight,
		width: win.width - padX * 2,
		height: promptHeight
	};
	const sendSize = Math.min(promptHeight - gap * 2, text * 2.6);
	const send = {
		x: prompt.x + prompt.width - gap - sendSize / 2,
		y: prompt.y + prompt.height / 2,
		size: sendSize,
		press: 0
	};
	const textStartX = prompt.x + gap + text * 1.4;
	const rowCenterY = (row: number): number => prompt.y + gap + (row + 0.5) * lineHeight;

	const types = eventsOfKind(content.events, 'type', durationSeconds);
	const sends = eventsOfKind(content.events, 'send', durationSeconds);

	/** The draft a person has in the prompt at a time: their latest typing, unless they have sent it. */
	function draftOf(userId: string, time: number): { text: string; isTyping: boolean } {
		const typed = types.filter((item) => item.event.user === userId && item.seconds <= time).at(-1);
		if (!typed) return { text: '', isTyping: false };
		const sent = sends.some(
			(item) => item.event.user === userId && item.seconds >= typed.seconds && item.seconds <= time
		);
		if (sent) return { text: '', isTyping: false };
		const length = typed.event.duration * durationSeconds;
		const progress = clamp01((time - typed.seconds) / length);
		const count = Math.round(typed.event.text.length * progress);
		return { text: typed.event.text.slice(0, count), isTyping: progress < 1 };
	}

	const rows: MultiplayerSessionPromptRow[] = users.map((user, row) => {
		const draft = draftOf(user.id, seconds);
		return {
			userId: user.id,
			color: colorOf(user.id),
			text: draft.text,
			isTyping: draft.isTyping,
			textX: textStartX,
			centerY: rowCenterY(row)
		};
	});
	const caretAt = (userId: string, time: number): { x: number; y: number } => {
		const row = Math.max(
			0,
			users.findIndex((user) => user.id === userId)
		);
		return {
			x: textStartX + draftOf(userId, time).text.length * text * MONO_ADVANCE + text * 0.4,
			y: rowCenterY(row) + text * 0.35
		};
	};

	// ---------------------------------------------------------------- forks
	const forkEvents = eventsOfKind(content.events, 'fork', durationSeconds);
	const forkWidth = Math.min(text * 16, layout.forkSide === 'right' ? frameWidth * 0.3 : win.width);
	const forkHeight = lineHeight * 2 + gap * 2;
	const forkRect = (order: number): MultiplayerSessionRect =>
		layout.forkSide === 'right'
			? {
					x: win.x + win.width + unit * 5,
					y: win.y + win.headerHeight + order * (forkHeight + unit * 3),
					width: forkWidth,
					height: forkHeight
				}
			: {
					x: win.x + order * (Math.min(forkWidth, (win.width - unit * 3) / 2) + unit * 3),
					y: win.y + win.height + unit * 5,
					width: Math.min(forkWidth, (win.width - unit * 3) / 2),
					height: forkHeight
				};
	// ---------------------------------------------------------------- log
	const logViewport = {
		x: win.x + padX,
		y: win.y + win.headerHeight,
		width: win.width - padX * 2,
		height: prompt.y - gap - (win.y + win.headerHeight)
	};
	const waitHeight = lineHeight * 2.6 + gap;
	const entryGap = gap * 0.7;
	interface PendingEntry {
		seconds: number;
		height: number;
		build: (rect: MultiplayerSessionRect, opacity: number) => MultiplayerSessionLogEntry;
	}
	const pending: PendingEntry[] = [];
	const steps = eventsOfKind(content.events, 'step', durationSeconds);
	content.events.forEach((event, index) => {
		const eventSeconds = at(event.at);
		const key = `event-${index}`;
		if (event.kind === 'send') {
			const typed = types
				.filter((item) => item.event.user === event.user && item.seconds <= eventSeconds)
				.at(-1);
			if (!typed) return;
			pending.push({
				seconds: eventSeconds,
				height: lineHeight,
				build: (rect, opacity) => ({
					key,
					kind: 'message',
					rect,
					opacity,
					name: nameOf(event.user),
					color: colorOf(event.user),
					text: typed.event.text,
					tag: event.tag
				})
			});
		} else if (event.kind === 'step') {
			const next = steps.find((item) => item.seconds > eventSeconds);
			pending.push({
				seconds: eventSeconds,
				height: lineHeight,
				build: (rect, opacity) => ({
					key,
					kind: 'step',
					rect,
					opacity,
					tool: event.tool,
					text: event.text,
					isDone: next !== undefined && seconds >= next.seconds
				})
			});
		} else if (event.kind === 'fork') {
			pending.push({
				seconds: eventSeconds,
				height: lineHeight,
				build: (rect, opacity) => ({ key, kind: 'fork', rect, opacity, text: event.label })
			});
		} else if (event.kind === 'wait') {
			pending.push({
				seconds: eventSeconds,
				height: waitHeight,
				build: (rect, opacity) => ({
					key,
					kind: 'wait',
					rect,
					opacity,
					text: event.text,
					timer:
						event.timerSeconds === undefined
							? undefined
							: formatMultiplayerSessionTimer(event.timerSeconds - (seconds - eventSeconds))
				})
			});
		}
	});
	pending.sort((a, b) => a.seconds - b.seconds);

	/** Where the newest-but-n entry sits: entries stack up from the prompt, each growing in as it arrives. */
	function layoutLog(time: number): { entry: PendingEntry; rect: MultiplayerSessionRect; grow: number }[] {
		const visible = pending.filter((entry) => entry.seconds <= time);
		const placed: { entry: PendingEntry; rect: MultiplayerSessionRect; grow: number }[] = [];
		let bottom = logViewport.y + logViewport.height;
		for (let index = visible.length - 1; index >= 0; index -= 1) {
			const entry = visible[index];
			const grow = settled((time - entry.seconds) / ENTRY_GROW_SECONDS);
			const height = entry.height;
			placed.unshift({
				entry,
				grow,
				rect: { x: logViewport.x, y: bottom - height, width: logViewport.width, height }
			});
			bottom -= (height + entryGap) * grow;
		}
		return placed;
	}

	const log = layoutLog(seconds)
		.map(({ entry, rect, grow }) => {
			const fadeTop = logViewport.y + lineHeight;
			const edge = clamp01((rect.y - logViewport.y + lineHeight * 0.5) / (fadeTop - logViewport.y));
			return entry.build({ ...rect, y: rect.y + (1 - grow) * lineHeight * 0.5 }, grow * edge);
		})
		.filter((entry) => entry.opacity > 0.001);

	// A fork's line leaves the window at its own log row, so the child visibly
	// comes out of the run; once that row scrolls away it leaves the log's top.
	const placedNow = layoutLog(seconds);
	const forkRowY = (time: number): number | undefined => {
		const placed = placedNow.find((p) => p.entry.seconds === time);
		return placed
			? Math.max(logViewport.y + lineHeight / 2, placed.rect.y + placed.rect.height / 2)
			: undefined;
	};
	const forks: MultiplayerSessionFork[] = forkEvents
		.filter((item) => item.seconds <= seconds)
		.map((item, order) => {
			const rect = forkRect(order);
			const from =
				layout.forkSide === 'right'
					? { x: win.x + win.width, y: forkRowY(item.seconds) ?? rect.y + rect.height / 2 }
					: { x: rect.x + rect.width / 2, y: win.y + win.height };
			const to =
				layout.forkSide === 'right'
					? { x: rect.x, y: rect.y + rect.height / 2 }
					: { x: rect.x + rect.width / 2, y: rect.y };
			const bend =
				layout.forkSide === 'right'
					? `C ${from.x + (to.x - from.x) * 0.6} ${from.y}, ${to.x - (to.x - from.x) * 0.6} ${to.y}`
					: `C ${from.x} ${from.y + (to.y - from.y) * 0.6}, ${to.x} ${to.y - (to.y - from.y) * 0.6}`;
			return {
				key: `fork-${item.index}`,
				label: item.event.label,
				detail: item.event.detail,
				rect,
				pop: pop((seconds - item.seconds) / FORK_POP_SECONDS),
				connector: `M ${from.x} ${from.y} ${bend} ${to.x} ${to.y}`
			};
		});

	// ---------------------------------------------------------------- status
	const waits = eventsOfKind(content.events, 'wait', durationSeconds);
	const activeWait = waits.filter((item) => item.seconds <= seconds).at(-1);
	const waitTimer = (time: number): string | undefined => {
		const wait = waits.filter((item) => item.seconds <= time).at(-1);
		if (!wait) return undefined;
		return wait.event.timerSeconds === undefined
			? 'paused'
			: formatMultiplayerSessionTimer(wait.event.timerSeconds - (time - wait.seconds));
	};
	const avatarSize = sizes.titleSize * unit * 1.6;
	const joins = eventsOfKind(content.events, 'join', durationSeconds);
	const avatars: MultiplayerSessionAvatar[] = joins
		.filter((item) => item.seconds <= seconds)
		.map((item, order) => ({
			userId: item.event.user,
			initial: nameOf(item.event.user).slice(0, 1).toUpperCase(),
			color: colorOf(item.event.user),
			x: win.x + win.width - padX - avatarSize / 2 - order * avatarSize * 0.72,
			y: win.y + win.headerHeight / 2,
			size: avatarSize,
			pop: pop((seconds - item.seconds) / AVATAR_POP_SECONDS)
		}))
		.reverse();
	const status = {
		isWaiting: activeWait !== undefined,
		label: activeWait
			? activeWait.event.timerSeconds === undefined
				? 'waiting'
				: `waiting · ${waitTimer(seconds)}`
			: 'running',
		x: win.x + padX + sizes.titleSize * unit * (content.title.length * 0.62 + 1.6),
		centerY: win.y + win.headerHeight / 2
	};

	// ---------------------------------------------------------------- cursors
	const sendPressSeconds = sends.map((item) => item.seconds);
	send.press = Math.max(
		0,
		...sendPressSeconds.map((time) => {
			const progress = (seconds - time) / CLICK_SECONDS;
			return progress >= 0 && progress <= 1 ? 1 - progress : 0;
		})
	);

	const cursors: MultiplayerSessionCursor[] = [];
	users.forEach((user, userIndex) => {
		const join = joins.find((item) => item.event.user === user.id);
		if (!join || seconds < join.seconds) return;
		const seed = hashStringToUnitInterval(user.id);
		const drift = (time: number): { x: number; y: number } => ({
			x: Math.sin(time * 0.9 + seed * 12) * unit * 0.6,
			y: Math.cos(time * 0.7 + seed * 7) * unit * 0.5
		});
		const restAt = {
			x: logViewport.x + logViewport.width * (0.35 + 0.45 * seed),
			y: logViewport.y + logViewport.height * (0.3 + 0.4 * ((seed * 7) % 1))
		};
		const fromSide = userIndex % 2 === 0 ? -1 : 1;
		const entryPoint = {
			x: fromSide < 0 ? -unit * 8 : frameWidth + unit * 8,
			y: frameHeight * (0.35 + 0.4 * seed)
		};
		const waypoints: CursorWaypoint[] = [
			{ start: join.seconds, travel: 1, target: () => entryPoint },
			{
				start: join.seconds,
				travel: CURSOR_JOIN_SECONDS,
				target: (time) => {
					const d = drift(time);
					return { x: restAt.x + d.x, y: restAt.y + d.y };
				}
			}
		];
		const clicks: number[] = [];
		for (const item of types.filter((typed) => typed.event.user === user.id)) {
			waypoints.push({
				start: Math.max(join.seconds, item.seconds - CURSOR_TRAVEL_SECONDS),
				travel: CURSOR_TRAVEL_SECONDS,
				target: (time) => caretAt(user.id, time)
			});
		}
		for (const item of sends.filter((sent) => sent.event.user === user.id)) {
			clicks.push(item.seconds);
			waypoints.push({
				start: item.seconds - CURSOR_TRAVEL_SECONDS * 0.8,
				travel: CURSOR_TRAVEL_SECONDS * 0.8,
				target: () => ({ x: send.x - send.size * 0.05, y: send.y + send.size * 0.05 })
			});
			waypoints.push({
				start: item.seconds + CLICK_SECONDS,
				travel: CURSOR_TRAVEL_SECONDS * 1.4,
				target: (time) => {
					const d = drift(time);
					return { x: restAt.x + d.x, y: restAt.y + d.y };
				}
			});
		}
		forkEvents.forEach((item, order) => {
			if (item.event.user !== user.id) return;
			const rect = forkRect(order);
			clicks.push(item.seconds);
			waypoints.push({
				start: item.seconds - CURSOR_TRAVEL_SECONDS,
				travel: CURSOR_TRAVEL_SECONDS,
				target: (time) => {
					const d = drift(time);
					return { x: rect.x + rect.width * 0.7 + d.x, y: rect.y + rect.height * 0.75 + d.y };
				}
			});
		});
		for (const item of waits) {
			const waitEntryTop = (time: number): number => {
				const placed = layoutLog(time).find((p) => p.entry.seconds === item.seconds);
				return placed ? placed.rect.y : logViewport.y + logViewport.height - waitHeight;
			};
			waypoints.push({
				start: item.seconds + 0.15 + userIndex * 0.12,
				travel: CURSOR_TRAVEL_SECONDS * 1.3,
				target: (time) => {
					const d = drift(time);
					return {
						x: logViewport.x + logViewport.width * (0.42 + userIndex * 0.22) + d.x,
						y: waitEntryTop(time) + waitHeight * (0.55 + (userIndex % 2) * 0.3) + d.y
					};
				}
			});
		}
		waypoints.sort((a, b) => a.start - b.start);
		const current = waypoints.findLastIndex((waypoint) => waypoint.start <= seconds);
		const position = cursorPosition(waypoints, Math.max(0, current), seconds);
		const click = Math.max(
			0,
			...clicks.map((time) => {
				const progress = (seconds - time) / CLICK_SECONDS;
				return progress >= 0 && progress <= 1 ? progress : 0;
			})
		);
		const ownWait = waits.filter((item) => item.seconds + userIndex * 0.12 + 0.3 <= seconds).at(-1);
		cursors.push({
			userId: user.id,
			name: user.name,
			color: colorOf(user.id),
			x: position.x,
			y: position.y,
			opacity: clamp01((seconds - join.seconds) / 0.25),
			click,
			status: ownWait ? `⏸ ${waitTimer(seconds)}` : undefined
		});
	});

	return {
		unit,
		window: win,
		status,
		avatars,
		log,
		logViewport,
		prompt: { ...prompt, rows, send },
		forks,
		cursors
	};
}
