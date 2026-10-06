import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
	decodeStageTypeface,
	encodeStageTypeface,
	listStageTypefaceCodePoints,
	STAGE_GLYPH_COMMAND,
	stageKerningKey,
	type StageTypefaceSource
} from './stage-glyph-format.ts';

const { move, line, quadratic, close } = STAGE_GLYPH_COMMAND;

function square(codePoint: number, size: number): StageTypefaceSource['glyphs'][number] {
	return {
		codePoint,
		advance: size + 100,
		commands: new Float32Array([move, 0, 0, line, size, 0, line, size, size, line, 0, size, close])
	};
}

const source: StageTypefaceSource = {
	unitsPerEm: 1000,
	capHeight: 700,
	xHeight: 500,
	ascender: 900,
	descender: -250,
	glyphs: [
		square(0x41, 600),
		{
			codePoint: 0x4f,
			advance: 700,
			commands: new Float32Array([move, 0, 350, quadratic, 0, 700, 350, 700, line, 700, 350, close])
		}
	],
	kerning: [{ left: 0x41, right: 0x4f, adjust: -40 }]
};

describe('stage glyph format', () => {
	it('round-trips metrics, outlines, advances, and kerning', () => {
		const bytes = encodeStageTypeface(source);
		const decoded = decodeStageTypeface(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
		assert.equal(decoded.unitsPerEm, 1000);
		assert.equal(decoded.capHeight, 700);
		assert.equal(decoded.descender, -250);
		assert.equal(decoded.glyphs.size, 2);
		const a = decoded.glyphs.get(0x41);
		assert.ok(a);
		assert.equal(a.advance, 700);
		assert.deepEqual(Array.from(a.commands), Array.from(source.glyphs[0].commands));
		const o = decoded.glyphs.get(0x4f);
		assert.ok(o);
		assert.equal(o.commands[3], quadratic);
		assert.equal(decoded.kerning.get(stageKerningKey(0x41, 0x4f)), -40);
		assert.equal(decoded.kerning.get(stageKerningKey(0x4f, 0x41)), undefined);
	});

	it('rejects a malformed outline before it is written', () => {
		assert.throws(
			() =>
				encodeStageTypeface({
					...source,
					glyphs: [{ codePoint: 0x42, advance: 10, commands: new Float32Array([move, 1]) }]
				}),
			/truncated/
		);
		assert.throws(
			() =>
				encodeStageTypeface({
					...source,
					glyphs: [{ codePoint: 0x42, advance: 10, commands: new Float32Array([9, 1, 1]) }]
				}),
			/unknown opcode/
		);
		assert.throws(
			() => encodeStageTypeface({ ...source, glyphs: [square(0x41, 1), square(0x41, 2)] }),
			/repeats/
		);
	});

	it('rejects bytes that are not this format', () => {
		const bytes = encodeStageTypeface(source);
		const wrongMagic = new Uint8Array(bytes);
		wrongMagic[0] = 0x58;
		assert.throws(() => decodeStageTypeface(wrongMagic.buffer), /wrong magic/);
		assert.throws(() => decodeStageTypeface(bytes.buffer.slice(0, bytes.byteLength - 4)), /expected/);
		assert.throws(() => decodeStageTypeface(new ArrayBuffer(8)), /truncated/);
	});

	it('carries the headline glyph set: ASCII, Latin-1, and typographic punctuation', () => {
		const points = listStageTypefaceCodePoints();
		assert.ok(points.includes(0x41) && points.includes(0xe9) && points.includes(0x2014));
		assert.equal(new Set(points).size, points.length);
		assert.ok(!points.includes(0x0a), 'no control characters');
	});
});
