import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { exportWebMInBrowser } from './browser-webm-export';
import type { TransparentVideoExportOptions } from './export-video';
import { findExportEnvelopeRejection } from './public-export-limits';
import { PUBLIC_EXPORT_RUNTIME_LIMITS } from './public-runtime-contract';

/**
 * A canvas the refusal never touches. The encoder is not constructed for a
 * refused export, so nothing here needs to be a real canvas.
 */
function exportOptions(
	overrides: Partial<TransparentVideoExportOptions>
): TransparentVideoExportOptions {
	return {
		canvas: new EventTarget() as unknown as OffscreenCanvas,
		durationSeconds: 1,
		fps: 30,
		renderFrame: () => undefined,
		...overrides
	};
}

/** ADR-0068 §9: the hosted origin's lane holds the public envelope by itself. */
describe('exportWebMInBrowser envelope refusal', () => {
	it('refuses a piece longer than the public envelope before a frame renders', async () => {
		let renderedFrames = 0;
		const options = exportOptions({
			durationSeconds: 20,
			fps: 30,
			renderFrame: () => {
				renderedFrames += 1;
			}
		});

		await assert.rejects(
			() => exportWebMInBrowser(options),
			(error: unknown) =>
				error instanceof Error &&
				error.message ===
					'Export spans 20.000 seconds; the limit is 15 seconds (450 frames at 30 fps).'
		);
		assert.equal(renderedFrames, 0);
	});

	it('refuses with the words the Node lane uses for the same request', async () => {
		const frameCount = PUBLIC_EXPORT_RUNTIME_LIMITS.maxFrameCount + 1;
		const nodeLaneRefusal = findExportEnvelopeRejection(
			{ format: 'webm', fps: 60, frameCount, audioBytes: 0 },
			PUBLIC_EXPORT_RUNTIME_LIMITS
		);
		assert.ok(nodeLaneRefusal);

		await assert.rejects(
			() => exportWebMInBrowser(exportOptions({ durationSeconds: 15, fps: 60, frameCount })),
			(error: unknown) => error instanceof Error && error.message === nodeLaneRefusal.message
		);
	});

	it('refuses a frame rate past the public envelope', async () => {
		await assert.rejects(
			() => exportWebMInBrowser(exportOptions({ durationSeconds: 1, fps: 120 })),
			/Export runs at 120 fps; the limit is 60 fps\./
		);
	});
});
