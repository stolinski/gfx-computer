/**
 * The `delivery` family: turning the composition into a file the visitor
 * receives
 * ([ADR-0054](../../../docs/adr/0054-webmcp-operation-transaction-and-security-contract.md) §2, §7).
 *
 * One call, one `AbortSignal`, one receipt. There is deliberately no progress
 * tool: a second way to ask about work already started invites a busy loop, and
 * the export either finishes or it does not. The receipt is issued only after
 * the encoded file exists and the browser has received every byte of it — a
 * cancelled or failed run returns `cancelled` or `export_failed`, never a
 * success receipt naming a file nobody has.
 *
 * The export takes no format argument. Format, orientation, rate, and
 * background fill are `transport`'s decisions, and they are what classify the
 * output: a piece exported in a format its own document does not declare would
 * carry a filename and an alpha lane the composition disagrees with. So the
 * corrective path for "export this as ProRes" is `transport.set-format` and
 * then this, which is also why this operation takes the observed revision — it
 * ships one specific version of the document.
 */
import { compositionEditHistory } from './composition-edit-history';
import { compositionExportHandle } from './composition-export-handle.svelte';
import {
	readOpenCompositionDocument,
	refuseCompositionOperation,
	refuseStaleCompositionRevision,
	refuseUnlessCompositionOpen,
	requireCompositionOperationRow,
	type CompositionOperationFailure
} from './composition-operation-preflight';

import type {
	CompositionExportCodec,
	CompositionOutputClassification
} from './composition-export-controller';
import type { EngineState } from './engine-schema';
import type { WebmcpOperationRow } from './webmcp-operation-inventory';

export interface CompositionDeliveryReceipt {
	status: 'delivered';
	operationId: string;
	/** The Composition revision the delivered file was rendered from. */
	revision: number;
	format: EngineState['transport']['format'];
	codec: CompositionExportCodec;
	output: CompositionOutputClassification;
	width: number;
	height: number;
	fps: number;
	frameCount: number;
	durationSeconds: number;
	videoFilename: string;
	/** Bytes of that file delivered to the browser. Only a completed download reports one. */
	videoByteLength: number;
	/** The sidecar WAV the browser also received, or null when audio stayed in the video. */
	wavFilename: string | null;
}

export interface ExportCompositionVideoRequest {
	/** The Composition revision the caller last observed; this ships that version. */
	expectedRevision: number;
	signal?: AbortSignal;
}

export type CompositionDeliveryOutcome = CompositionDeliveryReceipt | CompositionOperationFailure;

/**
 * The refusal for a page with no rendered composition. Export encodes the live
 * canvas frame by frame, so an unmounted Workspace has nothing to encode.
 */
function refuseMissingExportRunner(row: WebmcpOperationRow): CompositionOperationFailure {
	return refuseCompositionOperation(
		row,
		compositionEditHistory.revision,
		'precondition_unmet',
		'This composition is not on screen, so there are no frames to encode.'
	);
}

/**
 * Export the open composition and return only once the browser has the file.
 * Cancellation stops the render, the encode, and the download together, and the
 * export session destroys itself rather than leaving frames on the origin
 * ([ADR-0052](../../../docs/adr/0052-public-runtime-and-retention-architecture.md)).
 */
export async function runExportCompositionVideoOperation(
	request: ExportCompositionVideoRequest
): Promise<CompositionDeliveryOutcome> {
	const row = requireCompositionOperationRow('delivery.export-video');
	const openRefusal = refuseUnlessCompositionOpen(row);
	if (openRefusal) return openRefusal;

	const runExport = compositionExportHandle.current;
	if (!runExport) return refuseMissingExportRunner(row);

	const staleRefusal = refuseStaleCompositionRevision(row, request.expectedRevision);
	if (staleRefusal) return staleRefusal;

	if (request.signal?.aborted) {
		return refuseCompositionOperation(
			row,
			compositionEditHistory.revision,
			'cancelled',
			'The export was cancelled before it started.'
		);
	}

	const revision = compositionEditHistory.revision;
	const outcome = await runExport({ signal: request.signal });

	switch (outcome.status) {
		case 'delivered':
			return {
				status: 'delivered',
				operationId: row.id,
				revision,
				format: outcome.plan.format,
				codec: outcome.plan.codec,
				output: outcome.plan.output,
				width: outcome.plan.size.width,
				height: outcome.plan.size.height,
				fps: outcome.plan.fps,
				frameCount: outcome.plan.frameCount,
				durationSeconds: outcome.plan.durationSeconds,
				videoFilename: outcome.plan.videoFilename,
				videoByteLength: outcome.videoByteLength,
				wavFilename: outcome.wavFilename
			};
		case 'cancelled':
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'cancelled',
				'The export was cancelled; no file was produced.'
			);
		case 'busy':
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'precondition_unmet',
				'An export is already running; this composition encodes one at a time.'
			);
		case 'unavailable':
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'precondition_unmet',
				outcome.message
			);
		case 'failed':
			return refuseCompositionOperation(
				row,
				compositionEditHistory.revision,
				'export_failed',
				outcome.message,
				{ rejected: readOpenCompositionDocument().state.transport.format }
			);
	}
}
