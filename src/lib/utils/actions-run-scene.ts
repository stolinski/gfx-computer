import { evaluateNamedEase } from '$lib/utils/ease-curves';
import type { ActionsRunContent } from '$lib/pipelines/overlays/actions-run/definition';

// What an Actions run page shows at one moment: the trigger line, the run's
// status and clock, and each step's state. A pure function of time, so
// preview and export agree. The page's layout is left to the browser; only
// state lives here.

const TRIGGER_SWAP_SECONDS = 0.3;
const APPEAR_SECONDS = 0.35;

export type ActionsRunStatus = 'queued' | 'in-progress' | 'failure' | 'success';
export type ActionsRunStepState = 'pending' | 'running' | 'success' | 'failure' | 'restored';

export interface ActionsRunStepScene {
	key: string;
	name: string;
	state: ActionsRunStepState;
	/** The step's own run time on the run's clock, once it has one. */
	duration?: string;
	/** 0 → 1 as the step changes state, for a short highlight. */
	flash: number;
}

export interface ActionsRunScene {
	trigger: string;
	/** 0 → 1 as a new trigger replaces the old one. */
	triggerSwap: number;
	status: ActionsRunStatus;
	totalDuration: string;
	steps: ActionsRunStepScene[];
	/** The error annotation, while the run is failed. */
	error?: { message: string; clock?: string; appear: number };
	resume?: { label: string; appear: number };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function formatActionsRunDuration(seconds: number): string {
	const whole = Math.max(0, Math.round(seconds));
	const minutes = Math.floor(whole / 60);
	return minutes > 0 ? `${minutes}m ${whole % 60}s` : `${whole}s`;
}

export function resolveActionsRunScene(
	content: ActionsRunContent,
	seconds: number,
	durationSeconds: number
): ActionsRunScene {
	const at = (fraction: number): number => fraction * durationSeconds;
	const scale = content.timeScale ?? 20;
	const crashAt = content.crash ? at(content.crash.at) : Number.POSITIVE_INFINITY;
	const resumeAt = content.resume ? at(content.resume.at) : Number.POSITIVE_INFINITY;
	const finishAt = content.finishAt === undefined ? Number.POSITIVE_INFINITY : at(content.finishAt);
	const isCrashed = seconds >= crashAt && seconds < resumeAt;
	const isResumed = seconds >= resumeAt;

	const triggers = [...content.triggers].sort((a, b) => a.at - b.at);
	const current = triggers.filter((trigger) => at(trigger.at) <= seconds).at(-1) ?? triggers[0];
	const triggerSwap = clamp01((seconds - at(current.at)) / TRIGGER_SWAP_SECONDS);

	const firstRun = content.steps.map((step) => at(step.at));
	const failedIndex = firstRun.findLastIndex((start) => start <= crashAt);
	const rerun = content.steps.map((step) => (step.rerunAt === undefined ? undefined : at(step.rerunAt)));

	/** When a run of step `index` that started at `start` ends: at the next start in the same run. */
	function endOf(index: number, starts: readonly (number | undefined)[], end: number): number {
		const next = starts.slice(index + 1).find((value) => value !== undefined);
		return Math.min(next ?? end, end);
	}

	const steps: ActionsRunStepScene[] = content.steps.map((step, index) => {
		const key = `step-${index}`;
		const firstStart = firstRun[index];
		const isBeforeCrash = firstStart <= crashAt;
		const firstEnd = endOf(index, firstRun, Math.min(crashAt, finishAt));

		if (isResumed) {
			const restartAt = rerun[index];
			if (index < failedIndex) {
				return {
					key,
					name: step.name,
					state: 'restored',
					duration: formatActionsRunDuration((firstEnd - firstStart) * scale),
					flash: 1 - clamp01((seconds - resumeAt) / APPEAR_SECONDS)
				};
			}
			if (restartAt === undefined || seconds < restartAt) {
				return { key, name: step.name, state: 'pending', flash: 0 };
			}
			const end = endOf(index, rerun, finishAt);
			const isDone = seconds >= end;
			return {
				key,
				name: step.name,
				state: isDone ? 'success' : 'running',
				duration: formatActionsRunDuration(((isDone ? end : seconds) - restartAt) * scale),
				flash: 1 - clamp01((seconds - (isDone ? end : restartAt)) / APPEAR_SECONDS)
			};
		}

		if (seconds < firstStart || !isBeforeCrash) return { key, name: step.name, state: 'pending', flash: 0 };
		if (index === failedIndex && seconds >= crashAt) {
			return {
				key,
				name: step.name,
				state: 'failure',
				duration: formatActionsRunDuration((crashAt - firstStart) * scale),
				flash: 1 - clamp01((seconds - crashAt) / APPEAR_SECONDS)
			};
		}
		const isDone = seconds >= firstEnd;
		return {
			key,
			name: step.name,
			state: isDone ? 'success' : 'running',
			duration: formatActionsRunDuration(((isDone ? firstEnd : seconds) - firstStart) * scale),
			flash: 1 - clamp01((seconds - (isDone ? firstEnd : firstStart)) / APPEAR_SECONDS)
		};
	});

	const startedAt = firstRun.length > 0 ? Math.min(...firstRun) : 0;
	const status: ActionsRunStatus =
		seconds < startedAt
			? 'queued'
			: seconds >= finishAt
				? 'success'
				: isCrashed
					? 'failure'
					: 'in-progress';
	// The run's clock stops while it is failed and picks up again on resume.
	const clockEnd = Math.min(seconds, finishAt);
	const ranSeconds = Math.max(
		0,
		Math.min(clockEnd, crashAt) - startedAt + (isResumed ? clockEnd - resumeAt : 0)
	);

	return {
		trigger: current.text,
		triggerSwap: evaluateNamedEase('settled', triggerSwap),
		status,
		totalDuration: formatActionsRunDuration(ranSeconds * scale),
		steps,
		error:
			content.crash && isCrashed
				? {
						message: content.crash.message,
						clock: content.crash.clock,
						appear: evaluateNamedEase('settled', clamp01((seconds - crashAt) / APPEAR_SECONDS))
					}
				: undefined,
		resume:
			content.resume && isResumed
				? {
						label: content.resume.label,
						appear: evaluateNamedEase('settled', clamp01((seconds - resumeAt) / APPEAR_SECONDS))
					}
				: undefined
	};
}
