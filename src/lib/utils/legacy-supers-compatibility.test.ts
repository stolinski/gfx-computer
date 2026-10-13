import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	ACCEPTED_COMPOSITION_SCHEMA_IDS,
	ACCEPTED_HEAD_NOTE_PREFIXES,
	ACCEPTED_MARKER_SYNC_SCHEMAS,
	isAcceptedCompositionSchemaId,
	isAcceptedMarkerSyncSchema,
	isSweptExportDirectoryName,
	readGfxEnvironmentValue,
	SWEPT_EXPORT_DIRECTORY_PREFIXES
} from './legacy-supers-compatibility.ts';

describe('Legacy Supers compatibility matrix', () => {
	it('accepts both namespaces at every persisted surface', () => {
		assert.deepEqual([...ACCEPTED_COMPOSITION_SCHEMA_IDS], ['gfx@1', 'supers@1']);
		assert.deepEqual([...ACCEPTED_MARKER_SYNC_SCHEMAS], ['gfx-sync@1', 'supers-sync@1']);
		assert.deepEqual([...ACCEPTED_HEAD_NOTE_PREFIXES], ['gfx ', 'supers ']);
		assert.deepEqual([...SWEPT_EXPORT_DIRECTORY_PREFIXES], ['gfx-export-', 'supers-export-']);
	});

	it('rejects ids that belong to neither namespace', () => {
		assert.equal(isAcceptedCompositionSchemaId('gfx@1'), true);
		assert.equal(isAcceptedCompositionSchemaId('supers@1'), true);
		assert.equal(isAcceptedCompositionSchemaId('gfx@2'), false);
		assert.equal(isAcceptedCompositionSchemaId(undefined), false);

		assert.equal(isAcceptedMarkerSyncSchema('gfx-sync@1'), true);
		assert.equal(isAcceptedMarkerSyncSchema('supers-sync@1'), true);
		assert.equal(isAcceptedMarkerSyncSchema('other-sync@1'), false);
	});

	it('sweeps export directories written under either namespace', () => {
		assert.equal(isSweptExportDirectoryName('gfx-export-9a3f'), true);
		assert.equal(isSweptExportDirectoryName('supers-export-9a3f'), true);
		// A neighbouring temp directory is not ours to delete.
		assert.equal(isSweptExportDirectoryName('gfx-cli-download-9a3f'), false);
		assert.equal(isSweptExportDirectoryName('export-9a3f'), false);
	});

	describe('deprecated SUPERS_ environment aliases', () => {
		it('prefers the GFX name over the Legacy Supers one', () => {
			const value = readGfxEnvironmentValue(
				{ GFX_URL: 'http://gfx.test', SUPERS_URL: 'http://supers.test' },
				'GFX_URL'
			);
			assert.equal(value, 'http://gfx.test');
		});

		it('keeps an existing shell profile working through the Supers name', () => {
			assert.equal(
				readGfxEnvironmentValue(
					{ SUPERS_LAYOUT_CONTRACT_WAIT_MS: '90000' },
					'GFX_LAYOUT_CONTRACT_WAIT_MS'
				),
				'90000'
			);
		});

		it('reports undefined when neither spelling is exported, so call sites keep their defaults', () => {
			assert.equal(readGfxEnvironmentValue({}, 'GFX_CDP_URL'), undefined);
		});
	});
});
