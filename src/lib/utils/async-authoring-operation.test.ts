import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { AsyncAuthoringOperationGuard } from './async-authoring-operation';

describe('AsyncAuthoringOperationGuard', () => {
	it('rejects stale completions after a newer operation', () => {
		const guard = new AsyncAuthoringOperationGuard();
		const first = guard.begin();
		const second = guard.begin();

		assert.equal(guard.isCurrent(first), false);
		assert.equal(guard.isCurrent(second), true);
	});

	it('prevents an out-of-order completion from committing stale authored state', async () => {
		const guard = new AsyncAuthoringOperationGuard();
		const committed: string[] = [];
		let releaseFirst = (): void => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const firstGeneration = guard.begin();
		const first = firstGate.then(() => {
			if (guard.isCurrent(firstGeneration)) committed.push('first');
		});
		const secondGeneration = guard.begin();
		if (guard.isCurrent(secondGeneration)) committed.push('second');
		releaseFirst();
		await first;

		assert.deepEqual(committed, ['second']);
	});

	it('rejects every completion after component teardown', () => {
		const guard = new AsyncAuthoringOperationGuard();
		const generation = guard.begin();
		guard.dispose();

		assert.equal(guard.isCurrent(generation), false);
	});
});
