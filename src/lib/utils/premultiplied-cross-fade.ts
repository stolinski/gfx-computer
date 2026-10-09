/**
 * The cross-fade of two premultiplied-alpha pictures: `out × (1 − p) + in × p`
 * on every channel, alpha included. In premultiplied space that one formula is
 * the whole blend: a transparent pixel is all zeros, so it fades to or from
 * colour without a dark or bright fringe.
 *
 * This is the reference for the GPU blend of a Film's `fade` boundary
 * (`src/lib/platform/pipelines/film-boundary-fade.ts`), which runs the same
 * formula per pixel. `scripts/cdp-film-fade-tracer.mjs` holds a rendered Film
 * frame to it.
 */

/** `out × (1 − p) + in × p` for one channel value, with `progress` held to 0..1. */
export function crossFadePremultipliedChannel(
	outgoing: number,
	incoming: number,
	progress: number
): number {
	const held = Math.min(Math.max(progress, 0), 1);
	if (held === 0) return outgoing;
	if (held === 1) return incoming;
	return outgoing * (1 - held) + incoming * held;
}

/**
 * Straight-alpha RGBA bytes as premultiplied RGBA bytes: each colour channel
 * times alpha over 255, rounded to the nearest level. A picture read back from
 * a premultiplied canvas (a PNG, `getImageData`) is straight-alpha; this
 * recovers the 8-bit premultiplied values the canvas held exactly, because the
 * un-premultiply that made the straight value was itself rounded to nearest.
 *
 * Throws a `RangeError` when `straight` is not whole RGBA pixels.
 */
export function premultiplyStraightRgba8(straight: Uint8Array | Uint8ClampedArray): Uint8Array {
	if (straight.length % 4 !== 0) {
		throw new RangeError(`RGBA bytes come four to a pixel, got ${straight.length}.`);
	}
	const premultiplied = new Uint8Array(straight.length);
	for (let offset = 0; offset < straight.length; offset += 4) {
		const alpha = straight[offset + 3];
		premultiplied[offset] = Math.round((straight[offset] * alpha) / 255);
		premultiplied[offset + 1] = Math.round((straight[offset + 1] * alpha) / 255);
		premultiplied[offset + 2] = Math.round((straight[offset + 2] * alpha) / 255);
		premultiplied[offset + 3] = alpha;
	}
	return premultiplied;
}

/**
 * The cross-fade of two premultiplied RGBA byte pictures at 8 bits a channel:
 * `crossFadePremultipliedChannel` of every byte, rounded to the nearest level.
 *
 * Throws a `RangeError` when the two pictures differ in length.
 */
export function crossFadePremultipliedRgba8(
	outgoing: Uint8Array | Uint8ClampedArray,
	incoming: Uint8Array | Uint8ClampedArray,
	progress: number
): Uint8Array {
	if (outgoing.length !== incoming.length) {
		throw new RangeError(
			`A cross-fade needs two pictures of one size, got ${outgoing.length} and ${incoming.length} bytes.`
		);
	}
	const blended = new Uint8Array(outgoing.length);
	for (let offset = 0; offset < outgoing.length; offset += 1) {
		blended[offset] = Math.round(
			crossFadePremultipliedChannel(outgoing[offset], incoming[offset], progress)
		);
	}
	return blended;
}
