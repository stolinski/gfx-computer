import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { resolveTerminalRunScene } from './terminal-run-scene';
import {
	TERMINAL_RUN_DEFAULT_LAYOUT,
	TERMINAL_RUN_DEFAULT_SIZES,
	type TerminalRunContent
} from '$lib/pipelines/overlays/terminal-run/definition';

const DURATION = 10;

const content: TerminalRunContent = {
	title: 'zsh',
	prompt: '%',
	lines: [
		{ kind: 'info', text: 'started by cron', at: 0.05 },
		{ kind: 'info', text: 'started by webhook', at: 0.1, replaces: true },
		{ kind: 'step', text: 'step 1', at: 0.2 },
		{ kind: 'step', text: 'step 2', at: 0.3 },
		{ kind: 'error', text: 'killed', at: 0.4 },
		{ kind: 'command', text: 'pi resume 57', at: 0.5, duration: 0.1 },
		{ kind: 'restored', text: 'step 1 restored', at: 0.65 },
		{ kind: 'step', text: 'step 2', at: 0.7 },
		{ kind: 'prompt', text: '', at: 0.9 }
	],
	...TERMINAL_RUN_DEFAULT_LAYOUT,
	...TERMINAL_RUN_DEFAULT_SIZES
};

const at = (seconds: number, rows = 40) => resolveTerminalRunScene(content, seconds, DURATION, rows);

describe('resolveTerminalRunScene', () => {
	it('is a pure function of time', () => {
		assert.deepEqual(at(6.2), at(6.2));
	});

	it('redraws a replacing line in place of the one above it', () => {
		assert.deepEqual(
			at(1.5).rows.map((row) => row.text),
			['started by webhook']
		);
	});

	it('spins the latest step, ticks a step once the next prints, and crosses the step a kill interrupts', () => {
		assert.equal(at(2.5).rows[1].mark?.kind, 'spinner');
		assert.equal(at(3.5).rows[1].mark?.kind, 'done');
		assert.equal(at(4.5).rows[2].mark?.kind, 'failed');
	});

	it('types a command out with the cursor at its end', () => {
		const typing = at(5.5).rows.at(-1);
		assert.equal(typing?.text, 'pi res');
		assert.equal(typing?.hasCursor, true);
		assert.equal(at(5.5).isCursorLit, true);
	});

	it('marks restored steps and leaves the cursor on the closing prompt', () => {
		const end = at(9.5);
		assert.equal(end.rows.find((row) => row.kind === 'restored')?.mark?.kind, 'restored');
		assert.equal(end.rows.at(-1)?.kind, 'prompt');
		assert.equal(end.rows.at(-1)?.hasCursor, true);
	});

	it('scrolls the oldest rows off the top when the window is full', () => {
		assert.deepEqual(
			at(9.5, 2).rows.map((row) => row.kind),
			['step', 'prompt']
		);
	});
});
