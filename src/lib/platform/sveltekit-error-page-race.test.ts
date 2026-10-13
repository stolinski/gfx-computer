import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vite-plus/test';

interface SvelteKitErrorPageConfig {
	kit: {
		files: {
			errorTemplate: string;
		};
	};
}

interface SvelteKitConfigModule {
	load_error_page: (config: SvelteKitErrorPageConfig) => string;
}

function isSvelteKitConfigModule(value: unknown): value is SvelteKitConfigModule {
	return (
		typeof value === 'object' &&
		value !== null &&
		'load_error_page' in value &&
		typeof value.load_error_page === 'function'
	);
}

describe('SvelteKit error-page patch', () => {
	it('falls back when an atomic save removes the custom error page before it is read', async () => {
		const configModule: unknown = await import(
			new URL('../../../node_modules/@sveltejs/kit/src/core/config/index.js', import.meta.url).href
		);
		if (!isSvelteKitConfigModule(configModule)) {
			throw new TypeError('SvelteKit config module does not expose load_error_page');
		}

		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-error-page-'));
		const errorTemplate = path.join(temporaryDirectory, 'error.html');
		fs.writeFileSync(errorTemplate, 'custom error page');

		const originalReadFileSync = fs.readFileSync;
		const readFileSpy = vi.spyOn(fs, 'readFileSync');
		readFileSpy.mockImplementation((file, options) => {
			if (file === errorTemplate) {
				fs.unlinkSync(errorTemplate);
			}
			return originalReadFileSync(file, options);
		});

		try {
			const errorPage = configModule.load_error_page({ kit: { files: { errorTemplate } } });
			expect(errorPage).toContain('%sveltekit.error.message%');
			expect(errorPage).not.toContain('custom error page');
		} finally {
			readFileSpy.mockRestore();
			fs.rmSync(temporaryDirectory, { recursive: true, force: true });
		}
	});
});
