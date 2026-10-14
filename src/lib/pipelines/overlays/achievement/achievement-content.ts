import { z } from 'zod';

import { VARIANT_IDS } from './variants/variant-ids';

// Every size the card draws is the author's (ADR-0070). Each is optional and
// absent keeps the card's own proportions: box width per orientation as a
// fraction of the frame width, a minimum height as a fraction of the frame
// height, and text sizes and padding in `cqmin` (hundredths of the frame's
// shorter side).
const AchievementWidthSchema = z.strictObject({
	horizontal: z.number().min(0.1).max(1).optional(),
	vertical: z.number().min(0.1).max(1).optional()
});

export const AchievementContentSchema = z.strictObject({
	variant: z.enum(VARIANT_IDS).default('checklist-complete'),
	kicker: z.string().min(1),
	title: z.string().min(1),
	beat: z.number().min(0).max(1).default(0.3375),
	width: AchievementWidthSchema.optional(),
	minHeight: z.number().min(0).max(1).optional(),
	titleSize: z.number().min(0.5).max(20).optional(),
	kickerSize: z.number().min(0.5).max(20).optional(),
	paddingX: z.number().min(0).max(20).optional(),
	paddingY: z.number().min(0).max(20).optional()
});

export type AchievementContent = z.infer<typeof AchievementContentSchema>;
