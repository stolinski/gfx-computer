import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
	crossFadePremultipliedChannel,
	crossFadePremultipliedRgba8,
	premultiplyStraightRgba8
} from './premultiplied-cross-fade';

describe('the cross-fade of one premultiplied channel', () => {
	it('is out × (1 − p) + in × p', () => {
		assert.equal(crossFadePremultipliedChannel(200, 100, 0.25), 175);
		assert.equal(crossFadePremultipliedChannel(0, 255, 0.5), 127.5);
		assert.equal(crossFadePremultipliedChannel(64, 64, 0.5), 64);
	});

	it('is the outgoing value at progress 0 and the incoming value at progress 1, exactly', () => {
		assert.equal(crossFadePremultipliedChannel(201, 17, 0), 201);
		assert.equal(crossFadePremultipliedChannel(201, 17, 1), 17);
	});

	it('holds progress to 0..1', () => {
		assert.equal(crossFadePremultipliedChannel(201, 17, -0.5), 201);
		assert.equal(crossFadePremultipliedChannel(201, 17, 1.5), 17);
	});
});

describe('the cross-fade of two premultiplied pictures', () => {
	it('fades an opaque pixel to a transparent one through half colour at half alpha', () => {
		// Opaque orange to nothing. In premultiplied space the half-way pixel is
		// half the colour at half the alpha: the same orange, half covered.
		const orange = new Uint8Array([255, 128, 0, 255]);
		const nothing = new Uint8Array([0, 0, 0, 0]);

		assert.deepEqual([...crossFadePremultipliedRgba8(orange, nothing, 0.5)], [128, 64, 0, 128]);
		assert.deepEqual([...crossFadePremultipliedRgba8(orange, nothing, 0)], [255, 128, 0, 255]);
		assert.deepEqual([...crossFadePremultipliedRgba8(orange, nothing, 1)], [0, 0, 0, 0]);
	});

	it('blends every channel of every pixel, alpha included, rounding to the nearest level', () => {
		const outgoing = new Uint8Array([10, 20, 30, 40, 200, 100, 50, 255]);
		const incoming = new Uint8Array([110, 20, 0, 255, 0, 0, 0, 0]);

		// 10 × 0.75 + 110 × 0.25 = 35; 30 × 0.75 = 22.5 → 23; 40 × 0.75 + 255 × 0.25 = 93.75 → 94.
		assert.deepEqual(
			[...crossFadePremultipliedRgba8(outgoing, incoming, 0.25)],
			[35, 20, 23, 94, 150, 75, 38, 191]
		);
	});

	it('never leaves a colour channel above its alpha', () => {
		const outgoing = new Uint8Array([255, 255, 255, 255]);
		const incoming = new Uint8Array([0, 0, 0, 0]);

		for (let step = 0; step <= 29; step += 1) {
			const [red, green, blue, alpha] = crossFadePremultipliedRgba8(outgoing, incoming, step / 29);
			assert.ok(red <= alpha && green <= alpha && blue <= alpha);
		}
	});

	it('refuses two pictures of different sizes', () => {
		assert.throws(
			() => crossFadePremultipliedRgba8(new Uint8Array(4), new Uint8Array(8), 0.5),
			RangeError
		);
	});
});

describe('premultiplying straight-alpha pixels', () => {
	it('multiplies each colour channel by alpha and keeps alpha', () => {
		assert.deepEqual(
			[
				...premultiplyStraightRgba8(new Uint8Array([255, 128, 0, 128, 10, 20, 30, 255, 9, 9, 9, 0]))
			],
			[128, 64, 0, 128, 10, 20, 30, 255, 0, 0, 0, 0]
		);
	});

	it('recovers every premultiplied value a canvas can hold from its straight-alpha read-back', () => {
		// A canvas hands back straight alpha: colour × 255 ÷ alpha, rounded to
		// nearest. Premultiplying that again must land on the value it started as.
		for (let alpha = 1; alpha <= 255; alpha += 1) {
			for (let premultiplied = 0; premultiplied <= alpha; premultiplied += 1) {
				const straight = Math.round((premultiplied * 255) / alpha);
				const [recovered] = premultiplyStraightRgba8(new Uint8Array([straight, 0, 0, alpha]));
				assert.equal(recovered, premultiplied, `${premultiplied} at alpha ${alpha}`);
			}
		}
	});

	it('refuses bytes that are not whole pixels', () => {
		assert.throws(() => premultiplyStraightRgba8(new Uint8Array(6)), RangeError);
	});
});
