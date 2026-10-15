import { z } from 'zod';

import { ICON_ORBIT_GLYPH_NAMES } from './icons';

import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

const ClipFractionSchema = z.number().min(0).max(1);

// One icon: what it stands for, when it launches, and the place around the
// subject it lands in. Angle 0 faces the camera, 90 is the viewer's right,
// 180 is straight behind the subject.
const IconOrbitIconSchema = z.strictObject({
	icon: z.enum(ICON_ORBIT_GLYPH_NAMES),
	label: z.string().max(40).optional(),
	launch: ClipFractionSchema,
	launchX: ClipFractionSchema.default(0.5),
	angle: z.number().min(-180).max(180),
	height: ClipFractionSchema
});

export type IconOrbitIcon = z.infer<typeof IconOrbitIconSchema>;

/** Which icons a render draws: all, only those behind the subject, or only those in front. */
export const ICON_ORBIT_PASSES = ['all', 'behind', 'front'] as const;
export type IconOrbitPass = (typeof ICON_ORBIT_PASSES)[number];

export const ICON_ORBIT_DEFAULT_ICON_SIZE = 11;
export const ICON_ORBIT_DEFAULT_LABEL_SIZE = 1.5;
export const ICON_ORBIT_DEFAULT_STROKE_WIDTH = 4.5;

// The ring an orientation films: where the speaker's centre line is, how wide
// the ring is, how far it tilts, and how big the icons are. A tall frame wants
// its own (ADR-0039 §4), so `orientationOverrides` holds a complete ring per
// orientation that replaces the shared values as one unit.
const IconOrbitRingSchema = z.strictObject({
	centerX: ClipFractionSchema,
	radius: z.number().min(0.05).max(0.6),
	tilt: z.number().min(-0.4).max(0.4),
	iconSize: z.number().min(2).max(40)
});

export type IconOrbitRing = z.infer<typeof IconOrbitRingSchema>;

// Sizes follow ADR-0070: icon and label sizes are in cqmin (hundredths of the
// frame's shorter side); the stroke is in the icon's own 120-unit box. The
// glow colour is the Pack's `icon-orbit.glow` Role unless `color` is authored.
const IconOrbitContentSchema = z.strictObject({
	icons: z.array(IconOrbitIconSchema).min(1).max(12),
	pass: z.enum(ICON_ORBIT_PASSES).default('all'),
	centerX: ClipFractionSchema.default(0.5),
	radius: z.number().min(0.05).max(0.6).default(0.3),
	turnDegreesPerSecond: z.number().min(-60).max(60).default(8),
	tilt: z.number().min(-0.4).max(0.4).default(0.18),
	iconSize: z.number().min(2).max(40).default(ICON_ORBIT_DEFAULT_ICON_SIZE),
	labelSize: z.number().min(0.5).max(10).default(ICON_ORBIT_DEFAULT_LABEL_SIZE),
	strokeWidth: z.number().min(1).max(12).default(ICON_ORBIT_DEFAULT_STROKE_WIDTH),
	glow: z.number().min(0).max(2).default(1),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional(),
	orientationOverrides: z
		.strictObject({
			horizontal: IconOrbitRingSchema.optional(),
			vertical: IconOrbitRingSchema.optional()
		})
		.optional()
});

export type IconOrbitContent = z.infer<typeof IconOrbitContentSchema>;

function defaults(): OverlayDefaults<IconOrbitContent> {
	return {
		content: {
			icons: [
				{ icon: 'storage', label: 'STORAGE', launch: 0.05, launchX: 0.3, angle: -70, height: 0.3 },
				{ icon: 'queue', label: 'QUEUE', launch: 0.15, launchX: 0.7, angle: 65, height: 0.26 },
				{ icon: 'socket', label: 'SOCKET', launch: 0.25, launchX: 0.55, angle: 150, height: 0.18 }
			],
			pass: 'all',
			centerX: 0.5,
			radius: 0.3,
			turnDegreesPerSecond: 8,
			tilt: 0.18,
			iconSize: ICON_ORBIT_DEFAULT_ICON_SIZE,
			labelSize: ICON_ORBIT_DEFAULT_LABEL_SIZE,
			strokeWidth: ICON_ORBIT_DEFAULT_STROKE_WIDTH,
			glow: 1
		},
		position: { anchor: 'top-left', offset: { x: 0, y: 0 } },
		enter: { start: 0, duration: 0.01, ease: 'smooth' },
		exit: { start: 0.97, duration: 0.03, ease: 'smooth' }
	};
}

export const iconOrbitOverlayDefinition = {
	type: 'icon-orbit',
	label: 'Icon orbit',
	schema: IconOrbitContentSchema,
	defaults,
	disableEntryOffset: true,
	readableText: (content) =>
		content.icons.flatMap((icon, index) =>
			icon.label
				? [{ id: `label-${index}`, text: icon.label, role: 'overlay-corner-secondary' as const }]
				: []
		)
} satisfies OverlayPipelineDefinition<IconOrbitContent>;
