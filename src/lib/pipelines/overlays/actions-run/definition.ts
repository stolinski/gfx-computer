import { z } from 'zod';

import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const ClipFractionSchema = z.number().min(0).max(1);

// A job step: it starts at `at` and runs until the next step starts. After a
// resume, a step that had already finished shows as restored, and the failed
// step and those after it run again from `rerunAt`.
const ActionsRunStepSchema = z.strictObject({
	name: z.string().min(1).max(40),
	at: ClipFractionSchema,
	rerunAt: ClipFractionSchema.optional()
});

export type ActionsRunStep = z.infer<typeof ActionsRunStepSchema>;

// The page's "Triggered via" line: each trigger replaces the one before at `at`.
const ActionsRunTriggerSchema = z.strictObject({
	text: z.string().min(1).max(40),
	at: ClipFractionSchema
});

const ActionsRunLayoutSchema = z.strictObject({
	x: ClipFractionSchema,
	y: ClipFractionSchema,
	width: z.number().min(0.2).max(1),
	height: z.number().min(0.2).max(1)
});

export type ActionsRunLayout = z.infer<typeof ActionsRunLayoutSchema>;

export const ACTIONS_RUN_DEFAULT_LAYOUT: ActionsRunLayout = {
	x: 0.12,
	y: 0.1,
	width: 0.76,
	height: 0.8
};

export const ACTIONS_RUN_DEFAULT_SIZES = {
	textSize: 2.1,
	titleSize: 3.2,
	paddingX: 3,
	paddingY: 2.4,
	gap: 1.6,
	radius: 1
} as const;

// A GitHub Actions run page, literal under every Pack (a found document,
// ADR-0038). Sizes follow ADR-0070 in cqmin. `timeScale` turns clip seconds
// into the run's own clock, so a few seconds on screen read as minutes.
const ActionsRunContentSchema = z.strictObject({
	repository: z.string().min(1).max(40),
	workflow: z.string().min(1).max(32),
	title: z.string().min(1).max(48),
	runNumber: z.number().int().min(1).max(99999),
	job: z.string().min(1).max(32),
	triggers: z.array(ActionsRunTriggerSchema).min(1).max(4),
	steps: z.array(ActionsRunStepSchema).min(1).max(12),
	crash: z
		.strictObject({
			at: ClipFractionSchema,
			message: z.string().min(1).max(64),
			clock: z.string().max(12).optional()
		})
		.optional(),
	resume: z.strictObject({ at: ClipFractionSchema, label: z.string().min(1).max(48) }).optional(),
	finishAt: ClipFractionSchema.optional(),
	timeScale: z.number().min(1).max(600).default(20),
	x: ClipFractionSchema.default(ACTIONS_RUN_DEFAULT_LAYOUT.x),
	y: ClipFractionSchema.default(ACTIONS_RUN_DEFAULT_LAYOUT.y),
	width: z.number().min(0.2).max(1).default(ACTIONS_RUN_DEFAULT_LAYOUT.width),
	height: z.number().min(0.2).max(1).default(ACTIONS_RUN_DEFAULT_LAYOUT.height),
	textSize: z.number().min(0.5).max(10).default(ACTIONS_RUN_DEFAULT_SIZES.textSize),
	titleSize: z.number().min(0.5).max(12).default(ACTIONS_RUN_DEFAULT_SIZES.titleSize),
	paddingX: z.number().min(0).max(20).default(ACTIONS_RUN_DEFAULT_SIZES.paddingX),
	paddingY: z.number().min(0).max(20).default(ACTIONS_RUN_DEFAULT_SIZES.paddingY),
	gap: z.number().min(0).max(20).default(ACTIONS_RUN_DEFAULT_SIZES.gap),
	radius: z.number().min(0).max(10).default(ACTIONS_RUN_DEFAULT_SIZES.radius),
	orientationOverrides: z
		.strictObject({
			horizontal: ActionsRunLayoutSchema.optional(),
			vertical: ActionsRunLayoutSchema.optional()
		})
		.optional()
});

export type ActionsRunContent = z.infer<typeof ActionsRunContentSchema>;

function defaults(): OverlayDefaults<ActionsRunContent> {
	return {
		content: {
			repository: 'acme/web',
			workflow: 'agent',
			title: 'Fix login redirect',
			runNumber: 57,
			job: 'fix-issue',
			triggers: [{ text: 'webhook', at: 0.02 }],
			steps: [
				{ name: 'Read issue #482', at: 0.1 },
				{ name: 'Plan the fix', at: 0.2 },
				{ name: 'Edit src/auth.ts', at: 0.3, rerunAt: 0.7 },
				{ name: 'Open pull request', at: 0.8, rerunAt: 0.8 }
			],
			crash: { at: 0.4, message: 'Process completed with exit code 137.', clock: '2:14 AM' },
			resume: { at: 0.65, label: 'Resumed from step 3' },
			finishAt: 0.9,
			timeScale: 20,
			...ACTIONS_RUN_DEFAULT_LAYOUT,
			...ACTIONS_RUN_DEFAULT_SIZES
		},
		position: { anchor: 'top-left', offset: { x: 0, y: 0 } },
		enter: { start: 0, duration: 0.02, ease: 'settled' },
		exit: { start: 0.98, duration: 0.02, ease: 'smooth' }
	};
}

export const actionsRunOverlayDefinition = {
	type: 'actions-run',
	label: 'Actions run',
	schema: ActionsRunContentSchema,
	defaults,
	disableEntryOffset: true,
	readableText: (content) => [
		{ id: 'title', text: content.title, role: 'overlay-corner-secondary' as const },
		...content.steps.map((step, index) => ({
			id: `step-${index}`,
			text: step.name,
			role: 'overlay-corner-secondary' as const
		}))
	]
} satisfies OverlayPipelineDefinition<ActionsRunContent>;
