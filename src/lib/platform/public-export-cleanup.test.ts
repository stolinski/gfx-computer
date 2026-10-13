import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import {
	exportCleanupReasonForExpiry,
	findExportCleanupLeak,
	findExportCleanupLeaks,
	type ExportCleanupReceipt
} from './public-export-cleanup';

const RELEASED: ExportCleanupReceipt = {
	sessionId: 'aSessionIdentity',
	reason: 'downloaded',
	encoderTerminated: true,
	downloadClosed: true,
	workDirectoryRemoved: true,
	elapsedMs: 3
};

describe('export cleanup receipts', () => {
	it('names nothing when a session released everything it held', () => {
		assert.equal(findExportCleanupLeak(RELEASED), null);
		assert.deepEqual(findExportCleanupLeaks([RELEASED, RELEASED]), []);
	});

	it('names each retained resource in the order a disposal releases them', () => {
		assert.equal(
			findExportCleanupLeak({ ...RELEASED, reason: 'lifetime-expired', downloadClosed: false }),
			'Export session aSessionIdentity (lifetime-expired) left its download body open.'
		);
		assert.equal(
			findExportCleanupLeak({ ...RELEASED, reason: 'cancelled', encoderTerminated: false }),
			'Export session aSessionIdentity (cancelled) left its encoder process running.'
		);
		assert.equal(
			findExportCleanupLeak({ ...RELEASED, reason: 'failed', workDirectoryRemoved: false }),
			'Export session aSessionIdentity (failed) left its work directory on disk.'
		);
	});

	it('collects every leak across a run of disposals', () => {
		assert.deepEqual(
			findExportCleanupLeaks([
				RELEASED,
				{ ...RELEASED, sessionId: 'anotherIdentity', workDirectoryRemoved: false }
			]),
			['Export session anotherIdentity (downloaded) left its work directory on disk.']
		);
	});

	it('reads each expiry clock in cleanup vocabulary', () => {
		assert.equal(exportCleanupReasonForExpiry('sessionLifetimeMs'), 'lifetime-expired');
		assert.equal(exportCleanupReasonForExpiry('sessionIdleMs'), 'idle-expired');
	});
});
