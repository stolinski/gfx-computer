import assert from 'node:assert/strict';

import { afterEach, describe, it, vi } from 'vite-plus/test';

afterEach(() => {
	vi.doUnmock('./hosted-origin');
	vi.resetModules();
});

async function loadFormats(isHostedOrigin: boolean) {
	vi.doMock('./hosted-origin', () => ({ IS_HOSTED_ORIGIN: isHostedOrigin }));
	return import('./composition-export-formats');
}

describe('composition export formats', () => {
	it('offers every encoded format on a local origin', async () => {
		const formats = await loadFormats(false);

		assert.deepEqual(formats.availableCompositionExportFormats(), ['webm', 'prores']);
		assert.equal(formats.isCompositionExportFormatAvailable('prores'), true);
	});

	it('offers WebM alone on the hosted origin, which has no ffmpeg', async () => {
		const formats = await loadFormats(true);

		assert.deepEqual(formats.availableCompositionExportFormats(), ['webm']);
		assert.equal(formats.isCompositionExportFormatAvailable('prores'), false);
		assert.equal(formats.isCompositionExportFormatAvailable('webm'), true);
	});

	it('names the lane that works here and the origin that has the other one', async () => {
		const formats = await loadFormats(true);
		const message = formats.unavailableCompositionExportFormatMessage('prores');

		assert.ok(message.includes('"prores"'));
		assert.ok(message.includes('"webm"'));
		assert.ok(message.includes('local GFX origin'));
	});

	it('labels every encoded format for the Format select', async () => {
		const formats = await loadFormats(false);

		for (const format of formats.COMPOSITION_EXPORT_FORMATS) {
			assert.ok(formats.COMPOSITION_EXPORT_FORMAT_LABELS[format].length > 0, format);
		}
	});
});
