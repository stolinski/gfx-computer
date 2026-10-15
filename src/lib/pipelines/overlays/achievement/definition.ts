import type { OverlayDefaults } from '$lib/platform/pipelines/types';
import { AchievementContentSchema, type AchievementContent } from './achievement-content';
import { resolveAchievementStyle } from './achievement-style';
import type { OverlayPipelineDefinition } from '$lib/platform/pipelines/definition-types';

function defaults(): OverlayDefaults<AchievementContent> {
	return {
		content: {
			icon: 'check',
			kickerStyle: 'text',
			motion: 'draw',
			kicker: 'TASK COMPLETE',
			title: 'Env vars set',
			beat: 0.3375
		},
		position: { anchor: 'top-right', offset: { x: 0.1, y: 0.08 } },
		enter: {
			start: 0,
			duration: 0.105,
			ease: 'settled',
			sound: { sample: 'foley-glide' }
		},
		exit: {
			start: 0.85,
			duration: 0.0875,
			ease: 'sharp',
			sound: { sample: 'foley-glide' }
		}
	};
}

export const achievementOverlayDefinition = {
	type: 'achievement',
	label: 'Achievement',
	schema: AchievementContentSchema,
	defaults,
	readableText: (content, context) => {
		// A popping kicker reads only once it has landed.
		const chipHeld =
			resolveAchievementStyle(content).motion !== 'pop' ||
			(context.progress - (content.beat ?? 0.3375)) * context.durationMilliseconds >= 450;
		return [
			...(chipHeld
				? [{ id: 'kicker', text: content.kicker, role: 'overlay-corner-secondary' as const }]
				: []),
			{ id: 'title', text: content.title, role: 'overlay-corner-primary' }
		];
	},
	edgeTransition: 'right'
} satisfies OverlayPipelineDefinition<AchievementContent>;
