import { describe, expect, it } from 'vite-plus/test';

import {
	formatMultiplayerSessionTimer,
	resolveMultiplayerSessionLayout,
	resolveMultiplayerSessionScene
} from './multiplayer-session-scene';
import {
	MULTIPLAYER_SESSION_DEFAULT_LAYOUT,
	MULTIPLAYER_SESSION_DEFAULT_SIZES,
	type MultiplayerSessionContent
} from '$lib/pipelines/overlays/multiplayer-session/definition';

const DURATION = 20;

const content: MultiplayerSessionContent = {
	title: 'agent',
	users: [
		{ id: 'scott', name: 'Scott' },
		{ id: 'wes', name: 'Wes', color: '#123456' }
	],
	events: [
		{ kind: 'step', tool: 'search', text: 'durable agents', at: 0.02 },
		{ kind: 'join', user: 'scott', at: 0.05 },
		{ kind: 'join', user: 'wes', at: 0.1 },
		{ kind: 'type', user: 'scott', text: 'research', at: 0.2, duration: 0.1 },
		{ kind: 'type', user: 'wes', text: 'keep it short', at: 0.22, duration: 0.1 },
		{ kind: 'send', user: 'scott', at: 0.4 },
		{ kind: 'fork', label: 'compare', user: 'wes', at: 0.5 },
		{ kind: 'wait', text: 'Publish?', timerSeconds: 120, at: 0.7 }
	],
	...MULTIPLAYER_SESSION_DEFAULT_LAYOUT,
	...MULTIPLAYER_SESSION_DEFAULT_SIZES
};

function sceneAt(seconds: number) {
	return resolveMultiplayerSessionScene(
		content,
		MULTIPLAYER_SESSION_DEFAULT_LAYOUT,
		MULTIPLAYER_SESSION_DEFAULT_SIZES,
		seconds,
		DURATION,
		3840,
		2160
	);
}

describe('resolveMultiplayerSessionScene', () => {
	it('is a pure function of time', () => {
		expect(sceneAt(9.3)).toEqual(sceneAt(9.3));
	});

	it('shows a cursor only once its person joins, entering from off frame', () => {
		expect(sceneAt(0.5).cursors).toHaveLength(0);
		const justJoined = sceneAt(1.0).cursors[0];
		expect(justJoined.userId).toBe('scott');
		expect(justJoined.x).toBeLessThan(0);
	});

	it('types two drafts at once, each on its own row with the cursor on its caret', () => {
		const scene = sceneAt(5.5);
		const [scott, wes] = scene.prompt.rows;
		expect(scott.text.length).toBeGreaterThan(0);
		expect(wes.text.length).toBeGreaterThan(0);
		expect(wes.color).toBe('#123456');
		const scottCursor = scene.cursors.find((cursor) => cursor.userId === 'scott');
		expect(scottCursor?.y).toBeCloseTo(scott.centerY + scene.unit * 2.3 * 0.35, 0);
	});

	it('moves a sent draft out of the prompt and into the log', () => {
		const scene = sceneAt(8.5);
		expect(scene.prompt.rows[0].text).toBe('');
		expect(scene.log.some((entry) => entry.kind === 'message' && entry.text === 'research')).toBe(true);
	});

	it('peels a fork card off the window whose line leaves at its own log row', () => {
		const scene = sceneAt(10.6);
		expect(scene.forks).toHaveLength(1);
		const fork = scene.forks[0];
		expect(fork.rect.x).toBeGreaterThan(scene.window.x + scene.window.width);
		const row = scene.log.find((entry) => entry.kind === 'fork');
		const startY = Number(fork.connector.split(' ')[2]);
		expect(row).toBeDefined();
		expect(startY).toBeCloseTo((row?.rect.y ?? 0) + (row?.rect.height ?? 0) / 2, 0);
	});

	it('pauses the run and gives every name tag the same timer', () => {
		const scene = sceneAt(16);
		expect(scene.status.isWaiting).toBe(true);
		expect(scene.status.label).toBe('waiting · 1:58');
		expect(scene.cursors.map((cursor) => cursor.status)).toEqual(['⏸ 1:58', '⏸ 1:58']);
	});
});

describe('resolveMultiplayerSessionLayout', () => {
	it('uses an orientation’s own snapshot when it has one', () => {
		const vertical = { x: 0.05, y: 0.1, width: 0.9, height: 0.5, forkSide: 'below' as const };
		expect(
			resolveMultiplayerSessionLayout(MULTIPLAYER_SESSION_DEFAULT_LAYOUT, { vertical }, 'vertical')
		).toBe(vertical);
		expect(
			resolveMultiplayerSessionLayout(MULTIPLAYER_SESSION_DEFAULT_LAYOUT, { vertical }, 'horizontal')
		).toBe(MULTIPLAYER_SESSION_DEFAULT_LAYOUT);
	});
});

describe('formatMultiplayerSessionTimer', () => {
	it('counts down in whole seconds and stops at zero', () => {
		expect(formatMultiplayerSessionTimer(120)).toBe('2:00');
		expect(formatMultiplayerSessionTimer(61.2)).toBe('1:02');
		expect(formatMultiplayerSessionTimer(-3)).toBe('0:00');
	});
});
