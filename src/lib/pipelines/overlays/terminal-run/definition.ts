import { z } from 'zod';

import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const ClipFractionSchema = z.number().min(0).max(1);

/**
 * What a terminal line is. `command` is typed after the prompt over its
 * `duration`; `step` spins until the next line prints, then ticks (or crosses
 * if that next line is an `error`); `restored` is a step carried over from a
 * saved run, ticked and dim; `prompt` is an empty prompt whose cursor blinks
 * while it is the last line; the rest are coloured output.
 */
export const TERMINAL_RUN_LINE_KINDS = [
	'command',
	'output',
	'dim',
	'info',
	'success',
	'error',
	'step',
	'restored',
	'prompt'
] as const;
export type TerminalRunLineKind = (typeof TERMINAL_RUN_LINE_KINDS)[number];

// One line, printed at `at`. A line that `replaces` overwrites the line above
// it in place, the way a log line that redraws itself does.
const TerminalRunLineSchema = z.strictObject({
	kind: z.enum(TERMINAL_RUN_LINE_KINDS),
	text: z.string().max(72).default(''),
	at: ClipFractionSchema,
	duration: z.number().min(0.001).max(1).optional(),
	replaces: z.boolean().optional()
});

export type TerminalRunLine = z.infer<typeof TerminalRunLineSchema>;

const TerminalRunLayoutSchema = z.strictObject({
	x: ClipFractionSchema,
	y: ClipFractionSchema,
	width: z.number().min(0.2).max(1),
	height: z.number().min(0.2).max(1)
});

export type TerminalRunLayout = z.infer<typeof TerminalRunLayoutSchema>;

export const TERMINAL_RUN_DEFAULT_LAYOUT: TerminalRunLayout = {
	x: 0.15,
	y: 0.1,
	width: 0.7,
	height: 0.8
};

export const TERMINAL_RUN_DEFAULT_SIZES = {
	textSize: 2.4,
	titleSize: 1.7,
	paddingX: 2.6,
	paddingY: 2.2,
	radius: 1.4
} as const;

// A macOS terminal window, literal under every Pack (a found document,
// ADR-0038). Sizes follow ADR-0070 in cqmin; each stands alone.
const TerminalRunContentSchema = z.strictObject({
	title: z.string().min(1).max(48),
	prompt: z.string().min(1).max(32),
	lines: z.array(TerminalRunLineSchema).min(1).max(40),
	x: ClipFractionSchema.default(TERMINAL_RUN_DEFAULT_LAYOUT.x),
	y: ClipFractionSchema.default(TERMINAL_RUN_DEFAULT_LAYOUT.y),
	width: z.number().min(0.2).max(1).default(TERMINAL_RUN_DEFAULT_LAYOUT.width),
	height: z.number().min(0.2).max(1).default(TERMINAL_RUN_DEFAULT_LAYOUT.height),
	textSize: z.number().min(0.5).max(10).default(TERMINAL_RUN_DEFAULT_SIZES.textSize),
	titleSize: z.number().min(0.5).max(10).default(TERMINAL_RUN_DEFAULT_SIZES.titleSize),
	paddingX: z.number().min(0).max(20).default(TERMINAL_RUN_DEFAULT_SIZES.paddingX),
	paddingY: z.number().min(0).max(20).default(TERMINAL_RUN_DEFAULT_SIZES.paddingY),
	radius: z.number().min(0).max(10).default(TERMINAL_RUN_DEFAULT_SIZES.radius),
	orientationOverrides: z
		.strictObject({
			horizontal: TerminalRunLayoutSchema.optional(),
			vertical: TerminalRunLayoutSchema.optional()
		})
		.optional()
});

export type TerminalRunContent = z.infer<typeof TerminalRunContentSchema>;

function defaults(): OverlayDefaults<TerminalRunContent> {
	return {
		content: {
			title: 'pi-agent — zsh',
			prompt: 'scott@mini ~/acme %',
			lines: [
				{ kind: 'info', text: '▶ started by webhook · POST /hooks/issue', at: 0.05 },
				{ kind: 'step', text: 'step 1  read issue #482', at: 0.15 },
				{ kind: 'step', text: 'step 2  edit src/auth.ts', at: 0.25 },
				{ kind: 'error', text: 'zsh: killed     pi-agent run', at: 0.35 },
				{ kind: 'command', text: 'pi resume 57', at: 0.5, duration: 0.08 },
				{ kind: 'restored', text: 'step 1  read issue #482   restored', at: 0.62 },
				{ kind: 'step', text: 'step 2  edit src/auth.ts', at: 0.7 },
				{ kind: 'success', text: '✓ run 57 finished', at: 0.85 },
				{ kind: 'prompt', text: '', at: 0.88 }
			],
			...TERMINAL_RUN_DEFAULT_LAYOUT,
			...TERMINAL_RUN_DEFAULT_SIZES
		},
		position: { anchor: 'top-left', offset: { x: 0, y: 0 } },
		enter: { start: 0, duration: 0.02, ease: 'settled' },
		exit: { start: 0.98, duration: 0.02, ease: 'smooth' }
	};
}

export const terminalRunOverlayDefinition = {
	type: 'terminal-run',
	label: 'Terminal run',
	schema: TerminalRunContentSchema,
	defaults,
	disableEntryOffset: true,
	readableText: (content) =>
		content.lines.flatMap((line, index) =>
			line.text.length > 0
				? [{ id: `line-${index}`, text: line.text, role: 'overlay-corner-secondary' as const }]
				: []
		)
} satisfies OverlayPipelineDefinition<TerminalRunContent>;
