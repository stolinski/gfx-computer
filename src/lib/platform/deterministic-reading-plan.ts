import {
	resolveMarkForIndex,
	type EngineState,
	type MarkInstance
} from './engine-schema';
import { listSurfaceMarkInstances } from './surface-mark-instances';
import { opacityEnvelope, resolveCascadeTimings } from './cascade-timing';
import { getOverlayDefinition } from './pipelines/definition-registry';
import type { OverlayPipelineDefinition } from './pipelines/definition-types';

export interface DeterministicReadingWindowPlan {
	readingId: string;
	kind: 'post-mark' | 'overlay' | 'speech-caption';
	wordCount: number;
	startMilliseconds: number;
	endMilliseconds: number;
	requiredMilliseconds: number;
}

export type DeterministicReadingPlanResult =
	| { status: 'available'; windows: readonly DeterministicReadingWindowPlan[] }
	| { status: 'unavailable'; reason: string };

const READING_WORDS_PER_MINUTE = 200;

export function countDeterministicReadingWords(text: string): number {
	return text
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0).length;
}

function requiredReadingMilliseconds(wordCount: number, multiplier: number): number {
	return (wordCount * 60 * 1000 * multiplier) / READING_WORDS_PER_MINUTE;
}

function overlayDefinition(type: string): OverlayPipelineDefinition | null {
	return getOverlayDefinition(type);
}

interface RenderedMarkWindow {
	markIndex: number;
	mark: MarkInstance;
	startFraction: number;
	durationFraction: number;
}

function renderedMarkWindows(
	state: EngineState,
	windowsByEntity: ReadonlyMap<string, { startFraction: number; durationFraction: number }>
):
	| { status: 'available'; windows: readonly RenderedMarkWindow[] }
	| { status: 'unavailable'; reason: string } {
	const marks = listSurfaceMarkInstances(state.surface);
	const windows: RenderedMarkWindow[] = [];
	for (const [markIndex, mark] of marks.entries()) {
		let startFraction: number;
		let durationFraction: number;
		if (mark.window === 'static') {
			startFraction = 0;
			durationFraction = 0;
		} else if (mark.window) {
			startFraction = mark.window.start;
			durationFraction = mark.window.duration;
		} else {
			const cascaded = windowsByEntity.get(`mark:${markIndex}`);
			const resolved = resolveMarkForIndex(mark.style, markIndex, state.marks);
			startFraction = cascaded?.startFraction ?? resolved.start;
			durationFraction = cascaded?.durationFraction ?? resolved.duration;
		}
		if (
			!Number.isFinite(startFraction) ||
			!Number.isFinite(durationFraction) ||
			startFraction < 0 ||
			durationFraction < 0
		) {
			return { status: 'unavailable', reason: `rendered-mark-window-unavailable:${markIndex}` };
		}
		windows.push({ markIndex, mark, startFraction, durationFraction });
	}
	return { status: 'available', windows };
}

/** Derive the complete immutable G6 reading plan from parsed composition data. */
export function deriveDeterministicReadingPlan(state: EngineState): DeterministicReadingPlanResult {
	let windowsByEntity: Map<string, { startFraction: number; durationFraction: number }>;
	try {
		windowsByEntity = resolveCascadeTimings(state);
	} catch {
		return { status: 'unavailable', reason: 'cascade-timing-unavailable' };
	}
	const durationMilliseconds = state.transport.durationSeconds * 1000;
	const result: DeterministicReadingWindowPlan[] = [];
	const renderedWindows = renderedMarkWindows(state, windowsByEntity);
	if (renderedWindows.status === 'unavailable') return renderedWindows;
	const groupedMarks = new Map<string, RenderedMarkWindow[]>();
	for (const window of renderedWindows.windows) {
		const key = `${window.mark.startChar}:${window.mark.endChar}:${window.mark.itemIndex ?? 'body'}`;
		const group = groupedMarks.get(key) ?? [];
		group.push(window);
		groupedMarks.set(key, group);
	}
	const markSegments = [...groupedMarks.entries()]
		.map(([segmentIdentity, group]) => ({
			segmentIdentity,
			wordCount: countDeterministicReadingWords(group[0].mark.text),
			firstStartFraction: Math.min(...group.map((entry) => entry.startFraction)),
			lastEndFraction: Math.max(
				...group.map((entry) => entry.startFraction + entry.durationFraction)
			)
		}))
		.sort((left, right) => left.firstStartFraction - right.firstStartFraction);
	for (let index = 0; index < markSegments.length; index += 1) {
		const segment = markSegments[index];
		if (segment.wordCount === 0) {
			return {
				status: 'unavailable',
				reason: `rendered-mark-text-unavailable:${segment.segmentIdentity}`
			};
		}
		const next = markSegments[index + 1];
		const startMilliseconds = segment.lastEndFraction * durationMilliseconds;
		const endMilliseconds =
			(next?.firstStartFraction ?? state.surface.exit?.start ?? 1) * durationMilliseconds;
		result.push({
			readingId: `post-mark:${segment.segmentIdentity}`,
			kind: 'post-mark',
			wordCount: segment.wordCount,
			startMilliseconds,
			endMilliseconds,
			requiredMilliseconds: requiredReadingMilliseconds(segment.wordCount, 1.5)
		});
	}

	for (const overlay of state.overlays) {
		const definition = overlayDefinition(overlay.type);
		if (!definition)
			return { status: 'unavailable', reason: `overlay-definition-unavailable:${overlay.type}` };
		const parsed = definition.schema.safeParse(overlay.content);
		if (!parsed.success)
			return { status: 'unavailable', reason: `overlay-content-invalid:${overlay.id}` };
		if (!definition.readableText) {
			return {
				status: 'unavailable',
				reason: `overlay-reading-contract-unavailable:${overlay.type}`
			};
		}
		const declarations = definition.readableText(parsed.data, {
			progress: 1,
			durationMilliseconds
		});
		const text = declarations
			.map((entry) => entry.text.trim())
			.filter(Boolean)
			.join(' ');
		const wordCount = countDeterministicReadingWords(text);
		if (wordCount === 0) continue;
		const resolved = windowsByEntity.get(`overlay:${overlay.id}`);
		if (!resolved)
			return { status: 'unavailable', reason: `overlay-timing-unavailable:${overlay.id}` };
		const envelope = opacityEnvelope(overlay.animation?.channels?.opacity);
		const startMilliseconds = envelope
			? resolved.startFraction * durationMilliseconds + envelope.settleMs
			: (resolved.startFraction + resolved.durationFraction) * durationMilliseconds;
		const endMilliseconds = envelope
			? resolved.startFraction * durationMilliseconds + envelope.departMs
			: (overlay.exit?.start ?? 1) * durationMilliseconds;
		result.push({
			readingId: `overlay:${overlay.id}`,
			kind: 'overlay',
			wordCount,
			startMilliseconds,
			endMilliseconds,
			requiredMilliseconds: requiredReadingMilliseconds(wordCount, 2)
		});
	}

	for (const cue of state.captions?.cues ?? []) {
		const wordCount = countDeterministicReadingWords(cue.text);
		if (wordCount === 0) continue;
		result.push({
			readingId: `speech-caption:${cue.id}`,
			kind: 'speech-caption',
			wordCount,
			startMilliseconds: cue.startMs,
			endMilliseconds: cue.endMs,
			requiredMilliseconds: cue.endMs - cue.startMs
		});
	}
	const ids = result.map((entry) => entry.readingId);
	if (new Set(ids).size !== ids.length) {
		return { status: 'unavailable', reason: 'duplicate-reading-identity' };
	}
	return {
		status: 'available',
		windows: Object.freeze(result.map((entry) => Object.freeze(entry)))
	};
}
