import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vite-plus/test';

import { decodeStageTypeface, stageKerningKey } from './stage-glyph-format.ts';
import {
	getStageTypeface,
	listStageTypefaces,
	REFERENCE_STAGE_TYPEFACE_SLUG
} from './stage-typefaces.ts';

function bundledBytes(slug: string): ArrayBuffer {
	const bytes = readFileSync(resolve('src/lib/assets/typefaces', `${slug}.stageglyphs`));
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('stage typefaces', () => {
	it('registers the reference face', () => {
		assert.ok(getStageTypeface(REFERENCE_STAGE_TYPEFACE_SLUG));
		assert.ok(listStageTypefaces().length >= 5);
	});

	it('ships compiled bytes that match every registry entry', () => {
		for (const slug of listStageTypefaces()) {
			const typeface = getStageTypeface(slug);
			assert.ok(typeface);
			const data = decodeStageTypeface(bundledBytes(slug));
			assert.equal(data.glyphs.size, typeface.glyphs, `${slug} glyphs`);
			assert.equal(data.kerning.size, typeface.kerningPairs, `${slug} kerning`);
			assert.equal(data.unitsPerEm, typeface.unitsPerEm, `${slug} unitsPerEm`);
			assert.equal(data.capHeight, typeface.capHeight, `${slug} capHeight`);
			assert.ok(data.glyphs.has(0x41) && data.glyphs.has(0x61), `${slug} carries A and a`);
			assert.ok((data.glyphs.get(0x41)?.commands.length ?? 0) > 0, `${slug} A has an outline`);
			assert.equal(data.glyphs.get(0x20)?.commands.length, 0, `${slug} space is empty`);
		}
	});

	it('records the provenance of each face as the file the Pack ships', () => {
		for (const slug of listStageTypefaces()) {
			const typeface = getStageTypeface(slug);
			assert.ok(typeface);
			const source = readFileSync(resolve(typeface.source.file));
			assert.equal(createHash('sha256').update(source).digest('hex'), typeface.source.sha256, slug);
		}
	});

	it('kerns a pair the face kerns', () => {
		const data = decodeStageTypeface(bundledBytes(REFERENCE_STAGE_TYPEFACE_SLUG));
		const adjust = data.kerning.get(stageKerningKey(0x41, 0x56));
		assert.ok(adjust !== undefined && adjust < 0, 'AV tightens');
	});
});
