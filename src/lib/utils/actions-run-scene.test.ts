import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { formatActionsRunDuration, resolveActionsRunScene } from './actions-run-scene';
import { ACTIONS_RUN_DEFAULT_LAYOUT, ACTIONS_RUN_DEFAULT_SIZES, type ActionsRunContent } from '$lib/pipelines/overlays/actions-run/definition';

const DURATION = 10;

const content: ActionsRunContent = {
	repository: 'acme/web',
	workflow: 'agent',
	title: 'Fix login redirect',
	runNumber: 57,
	job: 'fix-issue',
	triggers: [
		{ text: 'cron', at: 0 },
		{ text: 'webhook', at: 0.05 }
	],
	steps: [
		{ name: 'Read', at: 0.1 },
		{ name: 'Plan', at: 0.2 },
		{ name: 'Edit', at: 0.3, rerunAt: 0.7 },
		{ name: 'Open PR', at: 0.8, rerunAt: 0.8 }
	],
	crash: { at: 0.4, message: 'exit code 137', clock: '2:14 AM' },
	resume: { at: 0.65, label: 'Resumed from step 3' },
	finishAt: 0.9,
	timeScale: 10,
	...ACTIONS_RUN_DEFAULT_LAYOUT,
	...ACTIONS_RUN_DEFAULT_SIZES
};

const states = (seconds: number) =>
	resolveActionsRunScene(content, seconds, DURATION).steps.map((step) => step.state);

describe('resolveActionsRunScene', () => {
	it('is a pure function of time', () => {
		assert.deepEqual(resolveActionsRunScene(content, 5.5, DURATION), resolveActionsRunScene(content, 5.5, DURATION));
	});

	it('swaps the trigger line as each trigger arrives', () => {
		assert.equal(resolveActionsRunScene(content, 0.2, DURATION).trigger, 'cron');
		assert.equal(resolveActionsRunScene(content, 1, DURATION).trigger, 'webhook');
	});

	it('runs steps in order, each finishing as the next starts', () => {
		assert.equal(resolveActionsRunScene(content, 0.5, DURATION).status, 'queued');
		assert.deepEqual(states(2.5), ['success', 'running', 'pending', 'pending']);
	});

	it('fails the running step on the crash and stops the clock', () => {
		const scene = resolveActionsRunScene(content, 5, DURATION);
		assert.equal(scene.status, 'failure');
		assert.deepEqual(states(5), ['success', 'success', 'failure', 'pending']);
		assert.equal(scene.error?.clock, '2:14 AM');
		assert.equal(scene.totalDuration, resolveActionsRunScene(content, 6, DURATION).totalDuration);
	});

	it('resumes: earlier steps are restored, not run again, and the failed step runs again', () => {
		assert.deepEqual(states(7.5), ['restored', 'restored', 'running', 'pending']);
		const done = resolveActionsRunScene(content, 9.5, DURATION);
		assert.equal(done.status, 'success');
		assert.deepEqual(states(9.5), ['restored', 'restored', 'success', 'success']);
		assert.equal(done.error, undefined);
		assert.equal(done.resume?.label, 'Resumed from step 3');
	});
});

describe('formatActionsRunDuration', () => {
	it('reads like GitHub', () => {
		assert.equal(formatActionsRunDuration(42), '42s');
		assert.equal(formatActionsRunDuration(95), '1m 35s');
	});
});
