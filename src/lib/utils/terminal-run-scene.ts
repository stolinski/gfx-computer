import type {
	TerminalRunContent,
	TerminalRunLineKind
} from '$lib/pipelines/overlays/terminal-run/definition';

// What a terminal shows at one moment: the lines printed so far (a replacing
// line overwrites the one above it), each step's spinner or mark, the typed
// part of a command, and whether the cursor is lit. Rows past the window's
// height scroll off the top. A pure function of time, so preview and export
// agree.

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_FRAMES_PER_SECOND = 12;
const CURSOR_BLINK_SECONDS = 0.53;
const PRINT_FADE_SECONDS = 0.12;

export type TerminalRunMark = 'spinner' | 'done' | 'failed' | 'restored';

export interface TerminalRunRow {
	key: string;
	kind: TerminalRunLineKind;
	text: string;
	/** Shown before a step: its spinner frame, or its tick or cross. */
	mark?: { kind: TerminalRunMark; glyph: string };
	/** The cursor sits at the end of this row. */
	hasCursor: boolean;
	opacity: number;
}

export interface TerminalRunScene {
	rows: TerminalRunRow[];
	isCursorLit: boolean;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function resolveTerminalRunScene(
	content: TerminalRunContent,
	seconds: number,
	durationSeconds: number,
	visibleRows: number
): TerminalRunScene {
	const lines = content.lines
		.map((line, index) => ({ line, index, seconds: line.at * durationSeconds }))
		.sort((a, b) => a.seconds - b.seconds);
	const printed = lines.filter((item) => item.seconds <= seconds);

	const rows: TerminalRunRow[] = [];
	printed.forEach((item, order) => {
		const next = printed[order + 1];
		const { line } = item;
		let text = line.text;
		let isTyping = false;
		if (line.kind === 'command') {
			const typing = (line.duration ?? 0.05) * durationSeconds;
			const progress = clamp01((seconds - item.seconds) / typing);
			text = line.text.slice(0, Math.round(line.text.length * progress));
			isTyping = progress < 1;
		}
		let mark: TerminalRunRow['mark'];
		if (line.kind === 'step') {
			if (!next) {
				const frame = Math.floor(seconds * SPINNER_FRAMES_PER_SECOND) % SPINNER_FRAMES.length;
				mark = { kind: 'spinner', glyph: SPINNER_FRAMES[frame] };
			} else if (next.line.kind === 'error') {
				mark = { kind: 'failed', glyph: '✗' };
			} else {
				mark = { kind: 'done', glyph: '✓' };
			}
		} else if (line.kind === 'restored') {
			mark = { kind: 'restored', glyph: '✓' };
		}
		const row: TerminalRunRow = {
			key: `line-${item.index}`,
			kind: line.kind,
			text,
			mark,
			hasCursor: !next && (line.kind === 'prompt' || isTyping || line.kind === 'command'),
			opacity: clamp01((seconds - item.seconds) / PRINT_FADE_SECONDS)
		};
		if (line.replaces && rows.length > 0) rows[rows.length - 1] = row;
		else rows.push(row);
	});

	const last = printed.at(-1);
	const isTypingNow =
		last?.line.kind === 'command' &&
		seconds - last.seconds < (last.line.duration ?? 0.05) * durationSeconds;
	return {
		rows: rows.slice(Math.max(0, rows.length - visibleRows)),
		// A cursor holds steady while typing and blinks while it waits.
		isCursorLit: isTypingNow || Math.floor(seconds / CURSOR_BLINK_SECONDS) % 2 === 0
	};
}
