// The bundled typeface format of the Dimensional Stage (ADR-0062, the
// compiled-typeface lane). A registered typeface ships as one `.stageglyphs`
// file the compile script writes from a Pack face and dimensional type
// decodes at load: a fixed header, a glyph table, a kerning table, then one
// stream of outline commands in font units. Curves stay curves — the stage
// flattens them to the tolerance a body's size asks for — so the file is the
// face, not one rasterisation of it. Nothing here depends on the GPU or on
// the app, so the compile script under Node and the browser loader share one
// encoder and decoder, exactly as `stage-mesh-format.ts` does for models.

export const STAGE_GLYPH_MAGIC = 'GFXT';
export const STAGE_GLYPH_FORMAT_VERSION = 1;
const HEADER_BYTES = 40;
const GLYPH_RECORD_BYTES = 16;
const KERNING_RECORD_BYTES = 12;

/** Outline opcodes in the command stream, each followed by its arguments. */
export const STAGE_GLYPH_COMMAND = {
	move: 0,
	line: 1,
	quadratic: 2,
	cubic: 3,
	close: 4
} as const;

/** How many floats follow each opcode. */
export const STAGE_GLYPH_COMMAND_ARITY: Record<number, number> = {
	[STAGE_GLYPH_COMMAND.move]: 2,
	[STAGE_GLYPH_COMMAND.line]: 2,
	[STAGE_GLYPH_COMMAND.quadratic]: 4,
	[STAGE_GLYPH_COMMAND.cubic]: 6,
	[STAGE_GLYPH_COMMAND.close]: 0
};

export interface StageGlyphOutline {
	codePoint: number;
	/** Horizontal advance in font units. */
	advance: number;
	/** The outline: opcode, arguments, opcode, arguments … in font units, y up. */
	commands: Float32Array;
}

export interface StageTypefaceMetrics {
	unitsPerEm: number;
	capHeight: number;
	xHeight: number;
	ascender: number;
	descender: number;
}

export interface StageTypefaceData extends StageTypefaceMetrics {
	glyphs: ReadonlyMap<number, StageGlyphOutline>;
	/** Pair kerning in font units, keyed by `stageKerningKey`. */
	kerning: ReadonlyMap<number, number>;
}

/** The decoded fields a caller supplies to encode. */
export interface StageTypefaceSource extends StageTypefaceMetrics {
	glyphs: readonly StageGlyphOutline[];
	kerning: readonly { left: number; right: number; adjust: number }[];
}

/** One integer key for a kerning pair; code points fit in 21 bits. */
export function stageKerningKey(left: number, right: number): number {
	return left * 0x110000 + right;
}

function assertOutlineStream(commands: Float32Array, codePoint: number): void {
	let cursor = 0;
	while (cursor < commands.length) {
		const opcode = commands[cursor];
		const arity = STAGE_GLYPH_COMMAND_ARITY[opcode];
		if (arity === undefined) {
			throw new TypeError(`Stage glyph U+${codePoint.toString(16)} has an unknown opcode ${opcode}.`);
		}
		if (cursor + arity >= commands.length) {
			throw new TypeError(`Stage glyph U+${codePoint.toString(16)} outline is truncated.`);
		}
		for (let index = cursor + 1; index <= cursor + arity; index += 1) {
			if (!Number.isFinite(commands[index])) {
				throw new TypeError(`Stage glyph U+${codePoint.toString(16)} has a non-finite coordinate.`);
			}
		}
		cursor += 1 + arity;
	}
	if (cursor !== commands.length) {
		throw new TypeError(`Stage glyph U+${codePoint.toString(16)} outline is truncated.`);
	}
}

/** Encode a typeface into the bundled byte layout. */
export function encodeStageTypeface(source: StageTypefaceSource): Uint8Array {
	if (!(source.unitsPerEm > 0)) throw new TypeError('Stage typeface unitsPerEm must be positive.');
	const seen = new Set<number>();
	let commandFloats = 0;
	for (const glyph of source.glyphs) {
		if (seen.has(glyph.codePoint)) {
			throw new TypeError(`Stage typeface repeats U+${glyph.codePoint.toString(16)}.`);
		}
		seen.add(glyph.codePoint);
		assertOutlineStream(glyph.commands, glyph.codePoint);
		commandFloats += glyph.commands.length;
	}
	const bytes = new Uint8Array(
		HEADER_BYTES +
			source.glyphs.length * GLYPH_RECORD_BYTES +
			source.kerning.length * KERNING_RECORD_BYTES +
			commandFloats * 4
	);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < 4; i += 1) bytes[i] = STAGE_GLYPH_MAGIC.charCodeAt(i);
	view.setUint32(4, STAGE_GLYPH_FORMAT_VERSION, true);
	view.setUint32(8, source.unitsPerEm, true);
	view.setUint32(12, source.glyphs.length, true);
	view.setUint32(16, source.kerning.length, true);
	view.setUint32(20, commandFloats, true);
	view.setInt32(24, Math.round(source.capHeight), true);
	view.setInt32(28, Math.round(source.xHeight), true);
	view.setInt32(32, Math.round(source.ascender), true);
	view.setInt32(36, Math.round(source.descender), true);
	let offset = HEADER_BYTES;
	let commandStart = 0;
	for (const glyph of source.glyphs) {
		view.setUint32(offset, glyph.codePoint, true);
		view.setInt32(offset + 4, Math.round(glyph.advance), true);
		view.setUint32(offset + 8, commandStart, true);
		view.setUint32(offset + 12, glyph.commands.length, true);
		commandStart += glyph.commands.length;
		offset += GLYPH_RECORD_BYTES;
	}
	for (const pair of source.kerning) {
		view.setUint32(offset, pair.left, true);
		view.setUint32(offset + 4, pair.right, true);
		view.setInt32(offset + 8, Math.round(pair.adjust), true);
		offset += KERNING_RECORD_BYTES;
	}
	const stream = new Float32Array(commandFloats);
	let cursor = 0;
	for (const glyph of source.glyphs) {
		stream.set(glyph.commands, cursor);
		cursor += glyph.commands.length;
	}
	bytes.set(new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength), offset);
	return bytes;
}

/** Decode bundled bytes, failing fast on a header that is not this format. */
export function decodeStageTypeface(buffer: ArrayBufferLike): StageTypefaceData {
	if (buffer.byteLength < HEADER_BYTES) throw new TypeError('Stage typeface file is truncated.');
	const view = new DataView(buffer);
	const magic = String.fromCharCode(
		view.getUint8(0),
		view.getUint8(1),
		view.getUint8(2),
		view.getUint8(3)
	);
	if (magic !== STAGE_GLYPH_MAGIC) throw new TypeError('Stage typeface file has the wrong magic.');
	const version = view.getUint32(4, true);
	if (version !== STAGE_GLYPH_FORMAT_VERSION) {
		throw new TypeError(`Stage typeface format version ${version} is not supported.`);
	}
	const unitsPerEm = view.getUint32(8, true);
	const glyphCount = view.getUint32(12, true);
	const kerningCount = view.getUint32(16, true);
	const commandFloats = view.getUint32(20, true);
	const capHeight = view.getInt32(24, true);
	const xHeight = view.getInt32(28, true);
	const ascender = view.getInt32(32, true);
	const descender = view.getInt32(36, true);
	const glyphTableBytes = glyphCount * GLYPH_RECORD_BYTES;
	const kerningTableBytes = kerningCount * KERNING_RECORD_BYTES;
	const streamOffset = HEADER_BYTES + glyphTableBytes + kerningTableBytes;
	const expected = streamOffset + commandFloats * 4;
	if (buffer.byteLength !== expected) {
		throw new TypeError(`Stage typeface file is ${buffer.byteLength} bytes; expected ${expected}.`);
	}
	if (!(unitsPerEm > 0) || !(capHeight > 0)) {
		throw new TypeError('Stage typeface metrics are not usable.');
	}
	// Copy out of the file buffer so the stream is aligned and owned.
	const stream = new Float32Array(commandFloats);
	stream.set(new Float32Array(buffer.slice(streamOffset, expected)));
	const glyphs = new Map<number, StageGlyphOutline>();
	let offset = HEADER_BYTES;
	for (let index = 0; index < glyphCount; index += 1) {
		const codePoint = view.getUint32(offset, true);
		const advance = view.getInt32(offset + 4, true);
		const commandStart = view.getUint32(offset + 8, true);
		const commandCount = view.getUint32(offset + 12, true);
		if (commandStart + commandCount > commandFloats) {
			throw new TypeError(`Stage glyph U+${codePoint.toString(16)} points past the outline stream.`);
		}
		const commands = stream.subarray(commandStart, commandStart + commandCount);
		assertOutlineStream(commands, codePoint);
		glyphs.set(codePoint, { codePoint, advance, commands });
		offset += GLYPH_RECORD_BYTES;
	}
	const kerning = new Map<number, number>();
	for (let index = 0; index < kerningCount; index += 1) {
		kerning.set(
			stageKerningKey(view.getUint32(offset, true), view.getUint32(offset + 4, true)),
			view.getInt32(offset + 8, true)
		);
		offset += KERNING_RECORD_BYTES;
	}
	return { unitsPerEm, capHeight, xHeight, ascender, descender, glyphs, kerning };
}

/**
 * The code points a compiled typeface carries: printable ASCII, the Latin-1
 * supplement, and the typographic punctuation a headline reaches for. Bounded
 * on purpose — a headline is not a paragraph, and a face is compiled once.
 */
export function listStageTypefaceCodePoints(): readonly number[] {
	const points: number[] = [];
	for (let point = 0x20; point <= 0x7e; point += 1) points.push(point);
	for (let point = 0xa0; point <= 0xff; point += 1) points.push(point);
	for (const point of [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac]) {
		points.push(point);
	}
	return points;
}
