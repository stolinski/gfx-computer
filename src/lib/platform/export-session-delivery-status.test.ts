import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	exportSessionDeliveryFailureMessage,
	exportSessionDeliveryStatusForCleanup,
	parseExportSessionDeliveryStatus
} from './export-session-delivery-status';

describe('exportSessionDeliveryStatusForCleanup', () => {
	it('says delivered, with the output size, only for a drained download', () => {
		assert.deepEqual(exportSessionDeliveryStatusForCleanup('downloaded', 4096), {
			state: 'delivered',
			outputBytes: 4096
		});
		for (const reason of [
			'cancelled',
			'failed',
			'idle-expired',
			'lifetime-expired',
			'shutdown'
		] as const) {
			assert.notEqual(exportSessionDeliveryStatusForCleanup(reason, 4096).state, 'delivered');
		}
	});

	it('names each other way a session ends', () => {
		assert.deepEqual(exportSessionDeliveryStatusForCleanup('cancelled', 1), { state: 'cancelled' });
		assert.deepEqual(exportSessionDeliveryStatusForCleanup('failed', 1), { state: 'failed' });
		assert.deepEqual(exportSessionDeliveryStatusForCleanup('shutdown', 1), { state: 'failed' });
		assert.deepEqual(exportSessionDeliveryStatusForCleanup('idle-expired', 1), {
			state: 'expired'
		});
		assert.deepEqual(exportSessionDeliveryStatusForCleanup('lifetime-expired', 1), {
			state: 'expired'
		});
	});
});

describe('parseExportSessionDeliveryStatus', () => {
	it('reads every state the origin writes', () => {
		for (const state of ['pending', 'downloading', 'cancelled', 'failed', 'expired'] as const) {
			assert.deepEqual(parseExportSessionDeliveryStatus({ state }), { state });
		}
		assert.deepEqual(parseExportSessionDeliveryStatus({ state: 'delivered', outputBytes: 12 }), {
			state: 'delivered',
			outputBytes: 12
		});
	});

	it('refuses a delivered document without a whole byte count, and anything else', () => {
		assert.equal(parseExportSessionDeliveryStatus({ state: 'delivered' }), null);
		assert.equal(parseExportSessionDeliveryStatus({ state: 'delivered', outputBytes: '12' }), null);
		assert.equal(parseExportSessionDeliveryStatus({ state: 'delivered', outputBytes: -1 }), null);
		assert.equal(parseExportSessionDeliveryStatus({ state: 'delivered', outputBytes: 1.5 }), null);
		assert.equal(parseExportSessionDeliveryStatus({ state: 'ready' }), null);
		assert.equal(parseExportSessionDeliveryStatus(null), null);
		assert.equal(parseExportSessionDeliveryStatus(['delivered']), null);
		assert.equal(parseExportSessionDeliveryStatus('delivered'), null);
	});
});

describe('exportSessionDeliveryFailureMessage', () => {
	it('says why each undelivered ending produced no file', () => {
		assert.match(exportSessionDeliveryFailureMessage('cancelled'), /stopped/);
		assert.match(exportSessionDeliveryFailureMessage('failed'), /failed/);
		assert.match(exportSessionDeliveryFailureMessage('expired'), /expired/);
	});
});
