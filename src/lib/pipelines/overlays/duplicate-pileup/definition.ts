import { z } from 'zod';

import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const ClipFractionSchema = z.number().min(0).max(1);
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** What a panel lists: an email inbox, or a repository's pull requests. */
export const DUPLICATE_PILEUP_PANEL_KINDS = ['inbox', 'pull-requests'] as const;
export type DuplicatePileupPanelKind = (typeof DUPLICATE_PILEUP_PANEL_KINDS)[number];

// One panel and the one thing that keeps landing in it. `copies` are the clip
// fractions each copy arrives at, the first being the real one; every later
// copy is a duplicate. A pull request's number counts up from `number`.
const DuplicatePileupPanelSchema = z.strictObject({
	kind: z.enum(DUPLICATE_PILEUP_PANEL_KINDS),
	title: z.string().min(1).max(24),
	at: ClipFractionSchema,
	item: z.string().min(1).max(48),
	meta: z.string().max(40).optional(),
	number: z.number().int().min(1).max(99999).optional(),
	copies: z.array(ClipFractionSchema).min(1).max(12)
});

export type DuplicatePileupPanel = z.infer<typeof DuplicatePileupPanelSchema>;

/** Side by side in a wide frame, stacked in a tall one. */
export const DUPLICATE_PILEUP_ARRANGEMENTS = ['row', 'column'] as const;
export type DuplicatePileupArrangement = (typeof DUPLICATE_PILEUP_ARRANGEMENTS)[number];

// Where the panels sit in one orientation, in frame fractions: the group's
// top-left corner, one panel's width and height, and how panels are arranged.
const DuplicatePileupLayoutSchema = z.strictObject({
	x: ClipFractionSchema,
	y: ClipFractionSchema,
	width: z.number().min(0.1).max(1),
	height: z.number().min(0.1).max(1),
	arrangement: z.enum(DUPLICATE_PILEUP_ARRANGEMENTS)
});

export type DuplicatePileupLayout = z.infer<typeof DuplicatePileupLayoutSchema>;

export const DUPLICATE_PILEUP_DEFAULT_LAYOUT: DuplicatePileupLayout = {
	x: 0.08,
	y: 0.16,
	width: 0.4,
	height: 0.66,
	arrangement: 'row'
};

export const DUPLICATE_PILEUP_DEFAULT_SIZES = {
	textSize: 2.2,
	titleSize: 2.4,
	labelSize: 3.4,
	paddingX: 2.6,
	paddingY: 2.2,
	gap: 3,
	radius: 2.2
} as const;

// Sizes follow ADR-0070 and are in cqmin; each stands alone. The panel fill,
// ink, and the alert and good colours are the Pack's `duplicate-pileup.*`
// Roles and field ink unless a colour is authored.
const DuplicatePileupContentSchema = z.strictObject({
	panels: z.array(DuplicatePileupPanelSchema).min(1).max(3),
	restart: z
		.strictObject({ label: z.string().min(1).max(32), at: ClipFractionSchema })
		.optional(),
	collapse: z
		.strictObject({ label: z.string().min(1).max(40), at: ClipFractionSchema })
		.optional(),
	x: ClipFractionSchema.default(DUPLICATE_PILEUP_DEFAULT_LAYOUT.x),
	y: ClipFractionSchema.default(DUPLICATE_PILEUP_DEFAULT_LAYOUT.y),
	width: z.number().min(0.1).max(1).default(DUPLICATE_PILEUP_DEFAULT_LAYOUT.width),
	height: z.number().min(0.1).max(1).default(DUPLICATE_PILEUP_DEFAULT_LAYOUT.height),
	arrangement: z.enum(DUPLICATE_PILEUP_ARRANGEMENTS).default('row'),
	textSize: z.number().min(0.5).max(10).default(DUPLICATE_PILEUP_DEFAULT_SIZES.textSize),
	titleSize: z.number().min(0.5).max(10).default(DUPLICATE_PILEUP_DEFAULT_SIZES.titleSize),
	labelSize: z.number().min(0.5).max(12).default(DUPLICATE_PILEUP_DEFAULT_SIZES.labelSize),
	paddingX: z.number().min(0).max(20).default(DUPLICATE_PILEUP_DEFAULT_SIZES.paddingX),
	paddingY: z.number().min(0).max(20).default(DUPLICATE_PILEUP_DEFAULT_SIZES.paddingY),
	gap: z.number().min(0).max(20).default(DUPLICATE_PILEUP_DEFAULT_SIZES.gap),
	radius: z.number().min(0).max(10).default(DUPLICATE_PILEUP_DEFAULT_SIZES.radius),
	windowColor: HexColorSchema.optional(),
	inkColor: HexColorSchema.optional(),
	alertColor: HexColorSchema.optional(),
	goodColor: HexColorSchema.optional(),
	orientationOverrides: z
		.strictObject({
			horizontal: DuplicatePileupLayoutSchema.optional(),
			vertical: DuplicatePileupLayoutSchema.optional()
		})
		.optional()
});

export type DuplicatePileupContent = z.infer<typeof DuplicatePileupContentSchema>;

function defaults(): OverlayDefaults<DuplicatePileupContent> {
	return {
		content: {
			panels: [
				{
					kind: 'inbox',
					title: 'Inbox',
					at: 0.02,
					item: 'Your weekly report',
					meta: 'agent@acme.dev',
					copies: [0.1, 0.4, 0.5, 0.58]
				},
				{
					kind: 'pull-requests',
					title: 'Pull requests',
					at: 0.3,
					item: 'Fix login redirect',
					meta: 'opened by agent',
					number: 214,
					copies: [0.36, 0.5, 0.62]
				}
			],
			restart: { label: 'process restarted', at: 0.3 },
			collapse: { label: 'durable: every step runs once', at: 0.8 },
			...DUPLICATE_PILEUP_DEFAULT_LAYOUT,
			...DUPLICATE_PILEUP_DEFAULT_SIZES
		},
		position: { anchor: 'top-left', offset: { x: 0, y: 0 } },
		enter: { start: 0, duration: 0.02, ease: 'settled' },
		exit: { start: 0.98, duration: 0.02, ease: 'smooth' }
	};
}

export const duplicatePileupOverlayDefinition = {
	type: 'duplicate-pileup',
	label: 'Duplicate pileup',
	schema: DuplicatePileupContentSchema,
	defaults,
	disableEntryOffset: true,
	readableText: (content) => [
		...content.panels.map((panel, index) => ({
			id: `panel-${index}`,
			text: panel.item,
			role: 'overlay-corner-secondary' as const
		})),
		...(content.collapse
			? [{ id: 'collapse', text: content.collapse.label, role: 'overlay-corner-secondary' as const }]
			: [])
	]
} satisfies OverlayPipelineDefinition<DuplicatePileupContent>;
