import { z } from 'zod';

import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const ClipFractionSchema = z.number().min(0).max(1);
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const UserIdSchema = z
	.string()
	.min(1)
	.max(24)
	.regex(/^[a-z0-9-]+$/);

/** A person in the session: their name tag, cursor, and typing all wear `color`. */
const MultiplayerSessionUserSchema = z.strictObject({
	id: UserIdSchema,
	name: z.string().min(1).max(20),
	color: HexColorSchema.optional()
});

export type MultiplayerSessionUser = z.infer<typeof MultiplayerSessionUserSchema>;

// What happens in the session, in clip fractions. A `join` flies a person's
// cursor in and adds their face to the header; `type` writes their draft into
// the shared prompt over `duration`; `send` posts that draft to the run log;
// `step` is a line the agent writes as it works; `fork` peels a child run off
// the window; `wait` parks the run on an approval or timer, and every name tag
// shows the same paused state.
const MultiplayerSessionEventSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('join'), user: UserIdSchema, at: ClipFractionSchema }),
	z.strictObject({
		kind: z.literal('type'),
		user: UserIdSchema,
		text: z.string().min(1).max(60),
		at: ClipFractionSchema,
		duration: z.number().min(0.001).max(1)
	}),
	z.strictObject({
		kind: z.literal('send'),
		user: UserIdSchema,
		at: ClipFractionSchema,
		tag: z.string().max(16).optional()
	}),
	z.strictObject({
		kind: z.literal('step'),
		tool: z.string().min(1).max(16),
		text: z.string().min(1).max(60),
		at: ClipFractionSchema
	}),
	z.strictObject({
		kind: z.literal('fork'),
		label: z.string().min(1).max(32),
		detail: z.string().max(40).optional(),
		user: UserIdSchema.optional(),
		at: ClipFractionSchema
	}),
	z.strictObject({
		kind: z.literal('wait'),
		text: z.string().min(1).max(48),
		timerSeconds: z.number().int().min(1).max(5999).optional(),
		at: ClipFractionSchema
	})
]);

export type MultiplayerSessionEvent = z.infer<typeof MultiplayerSessionEventSchema>;

/** Where child runs go: beside the window in a wide frame, under it in a tall one. */
export const MULTIPLAYER_SESSION_FORK_SIDES = ['right', 'below'] as const;
export type MultiplayerSessionForkSide = (typeof MULTIPLAYER_SESSION_FORK_SIDES)[number];

// The window's place in one orientation, in frame fractions: its top-left
// corner, width, and height, and which side its forks grow on. A tall frame
// wants its own (ADR-0039 §4), so `orientationOverrides` holds a complete
// layout per orientation that replaces the shared one as a unit.
const MultiplayerSessionLayoutSchema = z.strictObject({
	x: ClipFractionSchema,
	y: ClipFractionSchema,
	width: z.number().min(0.2).max(1),
	height: z.number().min(0.2).max(1),
	forkSide: z.enum(MULTIPLAYER_SESSION_FORK_SIDES)
});

export type MultiplayerSessionLayout = z.infer<typeof MultiplayerSessionLayoutSchema>;

export const MULTIPLAYER_SESSION_DEFAULT_LAYOUT: MultiplayerSessionLayout = {
	x: 0.1,
	y: 0.14,
	width: 0.5,
	height: 0.72,
	forkSide: 'right'
};

export const MULTIPLAYER_SESSION_DEFAULT_SIZES = {
	textSize: 2.3,
	titleSize: 2.4,
	nameSize: 1.9,
	cursorSize: 4,
	paddingX: 3,
	paddingY: 2.4,
	gap: 1.4,
	radius: 2.2
} as const;

/** The default colours people wear when a session does not author theirs. */
export const MULTIPLAYER_SESSION_USER_COLORS = ['#ff6b8b', '#4dabf7', '#3ddc84', '#ffb020'] as const;

// Sizes follow ADR-0070 and are in cqmin: text, title, name tags, cursor,
// padding, gap, and the window's corner radius each stand alone. The window
// fill, its ink, and the accent are the Pack's `multiplayer-session.*` Roles
// unless a colour is authored here.
const MultiplayerSessionContentSchema = z.strictObject({
	title: z.string().min(1).max(32).default('agent'),
	users: z.array(MultiplayerSessionUserSchema).min(1).max(4),
	events: z.array(MultiplayerSessionEventSchema).min(1).max(40),
	x: ClipFractionSchema.default(MULTIPLAYER_SESSION_DEFAULT_LAYOUT.x),
	y: ClipFractionSchema.default(MULTIPLAYER_SESSION_DEFAULT_LAYOUT.y),
	width: z.number().min(0.2).max(1).default(MULTIPLAYER_SESSION_DEFAULT_LAYOUT.width),
	height: z.number().min(0.2).max(1).default(MULTIPLAYER_SESSION_DEFAULT_LAYOUT.height),
	forkSide: z.enum(MULTIPLAYER_SESSION_FORK_SIDES).default('right'),
	textSize: z.number().min(0.5).max(10).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.textSize),
	titleSize: z.number().min(0.5).max(10).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.titleSize),
	nameSize: z.number().min(0.5).max(10).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.nameSize),
	cursorSize: z.number().min(1).max(20).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.cursorSize),
	paddingX: z.number().min(0).max(20).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.paddingX),
	paddingY: z.number().min(0).max(20).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.paddingY),
	gap: z.number().min(0).max(20).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.gap),
	radius: z.number().min(0).max(10).default(MULTIPLAYER_SESSION_DEFAULT_SIZES.radius),
	windowColor: HexColorSchema.optional(),
	inkColor: HexColorSchema.optional(),
	accentColor: HexColorSchema.optional(),
	orientationOverrides: z
		.strictObject({
			horizontal: MultiplayerSessionLayoutSchema.optional(),
			vertical: MultiplayerSessionLayoutSchema.optional()
		})
		.optional()
});

export type MultiplayerSessionContent = z.infer<typeof MultiplayerSessionContentSchema>;

function defaults(): OverlayDefaults<MultiplayerSessionContent> {
	return {
		content: {
			title: 'agent',
			users: [
				{ id: 'scott', name: 'Scott' },
				{ id: 'wes', name: 'Wes' }
			],
			events: [
				{ kind: 'step', tool: 'search', text: 'durable agents', at: 0.04 },
				{ kind: 'join', user: 'scott', at: 0.08 },
				{ kind: 'join', user: 'wes', at: 0.14 },
				{ kind: 'type', user: 'scott', text: 'research durable agents', at: 0.2, duration: 0.2 },
				{ kind: 'type', user: 'wes', text: 'keep it short', at: 0.26, duration: 0.16 },
				{ kind: 'send', user: 'scott', at: 0.46 },
				{ kind: 'send', user: 'wes', at: 0.5 },
				{ kind: 'fork', label: 'compare frameworks', user: 'scott', at: 0.62 },
				{ kind: 'wait', text: 'Publish the draft?', timerSeconds: 120, at: 0.78 }
			],
			...MULTIPLAYER_SESSION_DEFAULT_LAYOUT,
			...MULTIPLAYER_SESSION_DEFAULT_SIZES
		},
		position: { anchor: 'top-left', offset: { x: 0, y: 0 } },
		enter: { start: 0, duration: 0.02, ease: 'settled' },
		exit: { start: 0.98, duration: 0.02, ease: 'smooth' }
	};
}

export const multiplayerSessionOverlayDefinition = {
	type: 'multiplayer-session',
	label: 'Multiplayer session',
	schema: MultiplayerSessionContentSchema,
	defaults,
	disableEntryOffset: true,
	readableText: (content) => [
		{ id: 'title', text: content.title, role: 'overlay-corner-secondary' as const },
		...content.events.flatMap((event, index) =>
			event.kind === 'type' || event.kind === 'step' || event.kind === 'wait'
				? [{ id: `event-${index}`, text: event.text, role: 'overlay-corner-secondary' as const }]
				: []
		)
	]
} satisfies OverlayPipelineDefinition<MultiplayerSessionContent>;
