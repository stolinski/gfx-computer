/**
 * What an export session's owner is told about its one download (ADR-0052).
 *
 * The Node lane's output goes from the network to disk through the browser's own
 * download machinery, so the page that started it cannot watch it land. The
 * origin can: it knows whether the output was requested, whether it is still
 * streaming, and how the session ended. This is the document the session's
 * status read answers with, and the only thing the page learns the outcome from.
 *
 * It names a state and, for a delivered file, its size — never a path, a
 * filename, or content. Deliberately free of Node imports, like its
 * `public-export-*` peers: the origin writes this document and the page parses it.
 */

import type { ExportCleanupReason } from '$lib/platform/public-export-cleanup';

export type ExportSessionDeliveryStatus =
	/** The session is open and nothing has asked for its output yet. */
	| { state: 'pending' }
	/** The output is streaming to the browser that owns the session. */
	| { state: 'downloading' }
	/** The origin sent every byte of the output, and the session is gone. */
	| { state: 'delivered'; outputBytes: number }
	/** The transfer was stopped — by the browser, or by the session's owner. */
	| { state: 'cancelled' }
	/** The origin could not finish the transfer, or the host was stopped. */
	| { state: 'failed' }
	/** The session ran out one of its clocks before the output was delivered. */
	| { state: 'expired' };

export type ExportSessionDeliveryState = ExportSessionDeliveryStatus['state'];

/**
 * Ended sessions a store remembers the delivery outcome of. Bounded, because
 * the outcomes are themselves state the origin holds about a session that is
 * over: they exist so the owner's next status read has an answer, not to
 * accumulate a history.
 */
export const EXPORT_SESSION_DELIVERY_OUTCOME_HISTORY = 64;

/** What a session's owner is told once its session was disposed for `reason`. */
export function exportSessionDeliveryStatusForCleanup(
	reason: ExportCleanupReason,
	outputBytes: number
): ExportSessionDeliveryStatus {
	switch (reason) {
		case 'downloaded':
			return { state: 'delivered', outputBytes };
		case 'cancelled':
			return { state: 'cancelled' };
		case 'idle-expired':
		case 'lifetime-expired':
			return { state: 'expired' };
		case 'failed':
		case 'shutdown':
			return { state: 'failed' };
	}
}

/** Narrow a status read's JSON to the document it claims to be, or `null`. */
export function parseExportSessionDeliveryStatus(
	value: unknown
): ExportSessionDeliveryStatus | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	switch (record.state) {
		case 'pending':
		case 'downloading':
		case 'cancelled':
		case 'failed':
		case 'expired':
			return { state: record.state };
		case 'delivered':
			return typeof record.outputBytes === 'number' &&
				Number.isSafeInteger(record.outputBytes) &&
				record.outputBytes >= 0
				? { state: 'delivered', outputBytes: record.outputBytes }
				: null;
		default:
			return null;
	}
}

/** Why an export that ended in `state` did not deliver its file. */
export function exportSessionDeliveryFailureMessage(
	state: Exclude<ExportSessionDeliveryState, 'pending' | 'downloading' | 'delivered'>
): string {
	switch (state) {
		case 'cancelled':
			return 'The export download was stopped before the whole file was saved.';
		case 'expired':
			return 'The export session expired before the file was downloaded. Start a new export.';
		case 'failed':
			return 'The export download failed before the whole file was sent.';
	}
}
