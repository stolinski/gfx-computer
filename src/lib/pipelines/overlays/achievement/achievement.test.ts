import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { EngineState } from '$lib/platform/engine-schema';
import { cleanLightPack } from '$lib/packs/clean-light/manifest';
import { crtTerminalPack } from '$lib/packs/crt-terminal/manifest';
import { editorialMonoPack } from '$lib/packs/editorial-mono/manifest';
import { syntaxPack } from '$lib/packs/syntax/manifest';
import { resolveAppearanceVars } from '$lib/platform/packs/resolve';
import { deriveSoundCues } from '$lib/platform/sound-cues';
import { getVideoFrameSize } from '$lib/utils/video-frame';

import { achievementFrameLayout } from './achievement-frame-layout';
import type { AchievementContent } from './achievement-content';
import { achievementOverlayRenderer } from './index';
import { achievementDrawMotion, achievementPopMotion } from './achievement-motion';
import {
	resolveAchievementStyle,
	setAchievementBeat,
	setAchievementStyle
} from './achievement-style';

function stateWithAchievement(content: AchievementContent): EngineState {
	return {
		transport: { orientation: 'horizontal', durationSeconds: 4, fps: 30, format: 'webm' },
		typography: { fontFamily: 'sans' },
		marks: { defaults: {}, timings: [] },
		surface: { type: 'plain', content: { body: [] } },
		textAnimations: [],
		overlays: [
			{
				type: 'achievement',
				id: 'notice',
				content,
				position: { anchor: 'top-right', offset: { x: 0.1, y: 0.08 } },
				enter: { start: 0, duration: 0.105, ease: 'settled' },
				exit: { start: 0.85, duration: 0.0875, ease: 'sharp' }
			}
		],
		effects: [],
		audioCues: [],
		media: { assets: [], videoTrack: { clips: [] } }
	};
}

describe('achievement Overlay', () => {
	it('parses the look settings and rejects an unknown icon', () => {
		const valid = achievementOverlayRenderer.schema.safeParse({
			icon: 'star',
			kickerStyle: 'chip',
			motion: 'pop',
			kicker: 'TASK COMPLETE',
			title: 'Env vars set',
			beat: 0.3375
		});
		assert.ok(valid.success, valid.success ? '' : valid.error.message);

		const unknown = achievementOverlayRenderer.schema.safeParse({
			icon: 'medal',
			kicker: 'TASK COMPLETE',
			title: 'Env vars set',
			beat: 0.3375
		});
		assert.equal(unknown.success, false);
	});

	it('computes deterministic focal states for both motions', () => {
		assert.deepEqual(achievementDrawMotion(-1), achievementDrawMotion(-1));
		assert.equal(achievementDrawMotion(-1).glyphDraw, 0);
		assert.ok(achievementDrawMotion(160).glyphDraw > 0);
		assert.equal(achievementDrawMotion(320).glyphDraw, 1);

		assert.deepEqual(achievementPopMotion(240), achievementPopMotion(240));
		assert.equal(achievementPopMotion(-1).iconOpacity, 0);
		assert.equal(achievementPopMotion(-1).iconScale, 0.82);
		assert.ok(achievementPopMotion(160).iconOpacity > 0);
		assert.ok(achievementPopMotion(220).iconScale > 1);
		assert.equal(achievementPopMotion(450).iconScale, 1);
		assert.equal(achievementPopMotion(450).glyphDraw, 1);
		assert.equal(achievementPopMotion(220).kickerOpacity, 0);
		assert.equal(achievementPopMotion(450).kickerOpacity, 1);
	});

	it('reads a saved variant as its look and writes the look on the next edit', () => {
		const saved: AchievementContent = {
			variant: 'unlocked',
			kicker: 'ACHIEVEMENT UNLOCKED',
			title: 'Was nice to Claude',
			beat: 0.03
		};
		assert.deepEqual(resolveAchievementStyle(saved), {
			icon: 'star',
			kickerStyle: 'chip',
			motion: 'pop'
		});

		setAchievementStyle(saved, { icon: 'check' });
		assert.equal(saved.variant, undefined);
		assert.deepEqual(resolveAchievementStyle(saved), {
			icon: 'check',
			kickerStyle: 'chip',
			motion: 'pop'
		});
		assert.deepEqual(resolveAchievementStyle({}), {
			icon: 'check',
			kickerStyle: 'text',
			motion: 'draw'
		});
	});

	it('resolves deliberate achievement color and form roles for every Pack', () => {
		const cases = [
			{
				pack: syntaxPack,
				expected: {
					'--plate': '#141413',
					'--success': '#3dd816',
					'--border': '6px solid #454441',
					'--weight': '700'
				}
			},
			{
				pack: editorialMonoPack,
				expected: {
					'--plate': 'rgba(13, 18, 24, 0.94)',
					'--ink': '#eef3f8',
					'--success': '#22d3ee',
					'--shadow': 'none',
					'--weight': '600'
				}
			},
			{
				pack: crtTerminalPack,
				expected: {
					'--plate': 'rgba(4, 9, 6, 0.94)',
					'--success': '#45ff6e',
					'--radius': '0',
					'--tracking': '0.34em',
					'--weight': '600'
				}
			},
			{
				pack: cleanLightPack,
				expected: {
					'--plate': '#ffffff',
					'--ink': '#16181d',
					'--mutedInk': '#5b6472',
					'--success': '#0075de',
					'--weight': '600',
					'--kickerWeight': '500'
				}
			}
		] as const;

		for (const { pack, expected } of cases) {
			const vars = resolveAppearanceVars(pack, 'achievement');
			for (const [name, value] of Object.entries(expected)) {
				assert.equal(vars[name], value, `${pack.slug} resolves ${name}`);
			}
			assert.ok(vars['--border'], `${pack.slug} resolves a border treatment`);
			assert.ok(vars['--radius'], `${pack.slug} resolves a radius treatment`);
			assert.ok(vars['--pad'], `${pack.slug} resolves card spacing`);
			assert.ok(vars['--font'], `${pack.slug} resolves title type`);
			assert.ok(vars['--fontLabel'], `${pack.slug} resolves label type`);
		}
	});

	it('derives focal sound cues from the authored beat', () => {
		const checklistCues = deriveSoundCues(
			stateWithAchievement({
				kicker: 'TASK COMPLETE',
				title: 'Env vars set',
				beat: 0.3375
			})
		);
		const draw = checklistCues.find((cue) => cue.id === 'overlay:notice:beat-draw');
		const click = checklistCues.find((cue) => cue.id === 'overlay:notice:beat-click');
		assert.equal(draw?.start, 0.3375);
		assert.equal(draw?.event, 'draw');
		assert.ok(click && Math.abs(click.start - 0.4175) < 1e-9);
		assert.equal(click?.event, 'click');

		const unlockedCues = deriveSoundCues(
			stateWithAchievement({
				motion: 'pop',
				kicker: 'ACHIEVEMENT UNLOCKED',
				title: 'First commit',
				beat: 0.3375
			})
		);
		const pop = unlockedCues.find((cue) => cue.id === 'overlay:notice:beat-pop');
		assert.ok(pop && Math.abs(pop.start - 0.3825) < 1e-9);
		assert.equal(pop?.event, 'pop');
	});

	it('fits its horizontal and vertical frames inside the authored safe insets', () => {
		for (const orientation of ['horizontal', 'vertical'] as const) {
			const frame = getVideoFrameSize(orientation);
			const layout = achievementFrameLayout(orientation, frame.width, frame.height);
			const left = frame.width - layout.rightInset - layout.width;

			assert.ok(left >= frame.width * 0.05, `${orientation} left edge stays inside frame`);
			assert.ok(layout.rightInset >= frame.width * 0.09, `${orientation} clears action rail`);
			assert.ok(layout.topInset >= frame.height * 0.06, `${orientation} clears top safe band`);
			assert.ok(layout.width + layout.rightInset <= frame.width, `${orientation} does not clip`);
		}
	});

	it('applies editor and timeline state updates through the shared content object', () => {
		const content: AchievementContent = {
			kicker: 'TASK COMPLETE',
			title: 'Env vars set',
			beat: 0.3375
		};

		setAchievementStyle(content, { motion: 'pop' });
		setAchievementBeat(content, 1.2);
		assert.equal(content.motion, 'pop');
		assert.equal(content.beat, 1);

		setAchievementBeat(content, Number.NaN);
		assert.equal(content.beat, 1, 'invalid numeric editor input does not corrupt state');
	});

	it('takes authored sizes and keeps its own when none are set (ADR-0070)', () => {
		const sized = achievementOverlayRenderer.schema.safeParse({
			kicker: 'TASK COMPLETE',
			title: 'Env vars set',
			width: { horizontal: 0.5, vertical: 0.9 },
			minHeight: 0.2,
			titleSize: 6,
			kickerSize: 2.5,
			paddingX: 3,
			paddingY: 2
		});
		assert.ok(sized.success, sized.success ? '' : sized.error.message);

		const frame = getVideoFrameSize('horizontal');
		assert.equal(achievementFrameLayout('horizontal', frame.width, frame.height, 0.5).width, 1920);
		assert.equal(
			achievementFrameLayout('horizontal', frame.width, frame.height).width,
			Math.round(frame.width * 0.32)
		);

		const tooSmall = achievementOverlayRenderer.schema.safeParse({
			kicker: 'K',
			title: 'T',
			width: { horizontal: 0.01 }
		});
		assert.equal(tooSmall.success, false);
	});

	it('takes authored part colours, icon size, and gap, and refuses a non-hex colour', () => {
		const coloured = achievementOverlayRenderer.schema.safeParse({
			kicker: 'K',
			title: 'T',
			iconSize: 8,
			gap: 2,
			backgroundColor: '#101820',
			borderColor: '#334455',
			iconColor: '#ff3366',
			ringColor: '#222222',
			kickerColor: '#ffffff',
			chipColor: '#00aaff',
			titleColor: '#eeeeee'
		});
		assert.ok(coloured.success, coloured.success ? '' : coloured.error.message);

		const named = achievementOverlayRenderer.schema.safeParse({
			kicker: 'K',
			title: 'T',
			iconColor: 'red'
		});
		assert.equal(named.success, false);
	});
});
