import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vite-plus/test';

import { waitForAbortableDelay } from './abortable-delay';

afterEach(() => {
	vi.useRealTimers();
});

describe('waitForAbortableDelay', () => {
	it('resolves once the delay has passed', async () => {
		vi.useFakeTimers();
		let isSettled = false;
		const pending = waitForAbortableDelay(500).then(() => {
			isSettled = true;
		});

		await vi.advanceTimersByTimeAsync(499);
		assert.equal(isSettled, false);
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		assert.equal(isSettled, true);
	});

	it('rejects with the signal reason the moment it aborts, and leaves no timer', async () => {
		vi.useFakeTimers();
		const abortController = new AbortController();
		const pending = waitForAbortableDelay(60_000, abortController.signal);
		abortController.abort(new Error('stopped waiting'));

		await assert.rejects(pending, /stopped waiting/);
		assert.equal(vi.getTimerCount(), 0);
	});

	it('rejects without waiting when the signal already aborted', async () => {
		vi.useFakeTimers();
		const abortController = new AbortController();
		abortController.abort();

		await assert.rejects(waitForAbortableDelay(60_000, abortController.signal), /abort/i);
		assert.equal(vi.getTimerCount(), 0);
	});
});
