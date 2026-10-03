import type { KineticWordHierarchy } from '$lib/platform/engine-schema';
import { splitKineticWordGraphemes } from './kinetic-word-glyphs';

/**
 * Base letter-spacing per Kinetic Word hierarchy, in em. The renderer reads
 * the resolved value through `--kinetic-word-letter-spacing`, so this is the
 * one place the number lives; `tracking` adds to it.
 */
export const KINETIC_WORD_BASE_LETTER_SPACING_EM: Record<KineticWordHierarchy, number> = {
	display: -0.065,
	support: -0.035
};

/**
 * How far a word's ink sits inside its advance box on each side, in em. A
 * flush-left stack aligns ink, not boxes: `T` and `C` and `M` each carry a
 * different left side bearing, and a start anchor that ignores them leaves
 * three different "flush" edges on screen.
 */
export interface KineticWordOpticalBearings {
	startEm: number;
	endEm: number;
	/**
	 * How far the ink's vertical centre sits below the line box's centre, in em.
	 * Every face parks its caps somewhere different inside the same line box;
	 * shifting the word by this makes `y` the optical centre for every Pack.
	 */
	verticalOffsetEm: number;
	/** Space between the face's ascent and the ink's top, in em. */
	inkTopEm: number;
	/** Space between the ink's bottom and the face's descent, in em. */
	inkBottomEm: number;
	/** The face's ascent plus descent: the height a text run's box spans, in em. */
	contentEm: number;
}

const ZERO_BEARINGS: KineticWordOpticalBearings = {
	startEm: 0,
	endEm: 0,
	verticalOffsetEm: 0,
	inkTopEm: 0,
	inkBottomEm: 0,
	contentEm: 0
};
const REFERENCE_FONT_PX = 1000;
const measurementCache = new Map<string, KineticWordOpticalBearings>();
let measurementContext: OffscreenCanvasRenderingContext2D | null | undefined;

function readMeasurementContext(): OffscreenCanvasRenderingContext2D | null {
	if (measurementContext !== undefined) return measurementContext;
	if (typeof OffscreenCanvas === 'undefined') {
		measurementContext = null;
		return null;
	}
	measurementContext = new OffscreenCanvas(1, 1).getContext('2d');
	return measurementContext;
}

/**
 * Measure the outer side bearings of one word as the Pack face draws it at
 * this weight and letter-spacing. Kerning never touches the outer edges, so
 * only the first and last graphemes are measured; the result is em-relative
 * and therefore independent of the word's rendered size or scale.
 */
/**
 * The ink insets verification shrinks a word's text box by (ADR-0064): start,
 * top, end, bottom, and the content height they are fractions of, all in em.
 * Placement is optical, so the readable region a layout check measures must be
 * the ink, not the face's box.
 */
export function formatKineticWordInkInsets(bearings: KineticWordOpticalBearings): string {
	return [
		bearings.startEm,
		bearings.inkTopEm,
		bearings.endEm,
		bearings.inkBottomEm,
		bearings.contentEm
	].join(' ');
}

export function measureKineticWordOpticalBearings(
	text: string,
	fontFamily: string | undefined,
	fontWeight: number | undefined,
	letterSpacingEm: number
): KineticWordOpticalBearings {
	const context = readMeasurementContext();
	if (!context || !fontFamily || fontWeight === undefined) return ZERO_BEARINGS;
	const graphemes = splitKineticWordGraphemes(text);
	const first = graphemes[0];
	const last = graphemes[graphemes.length - 1];
	if (!first || !last) return ZERO_BEARINGS;

	const font = `${fontWeight} ${REFERENCE_FONT_PX}px ${fontFamily}`;
	const key = `${font}\u0000${first}\u0000${last}\u0000${letterSpacingEm}`;
	const cached = measurementCache.get(key);
	if (cached) return cached;

	context.font = font;
	context.textAlign = 'left';
	context.textBaseline = 'alphabetic';
	const head = context.measureText(first);
	const tail = context.measureText(last);
	const body = context.measureText(text);
	// actualBoundingBoxLeft is positive when ink extends left of the origin, so
	// the start bearing (origin to ink) is its negation. The box's right edge
	// includes the trailing letter-spacing Chrome applies after the last glyph.
	const startEm = -head.actualBoundingBoxLeft / REFERENCE_FONT_PX;
	const endEm = (tail.width - tail.actualBoundingBoxRight) / REFERENCE_FONT_PX + letterSpacingEm;
	// The CSS line box centres on the face's ascent/descent midpoint; the ink
	// centres on its own. Positive means the ink sits above the box centre.
	const inkCentre = (body.actualBoundingBoxAscent - body.actualBoundingBoxDescent) / 2;
	const boxCentre = (body.fontBoundingBoxAscent - body.fontBoundingBoxDescent) / 2;
	const verticalOffsetEm = (inkCentre - boxCentre) / REFERENCE_FONT_PX;
	const round = (value: number): number => Math.round(value * 10_000) / 10_000;
	const bearings = {
		startEm: round(startEm),
		endEm: round(endEm),
		verticalOffsetEm: round(verticalOffsetEm),
		inkTopEm: round(
			(body.fontBoundingBoxAscent - body.actualBoundingBoxAscent) / REFERENCE_FONT_PX
		),
		inkBottomEm: round(
			(body.fontBoundingBoxDescent - body.actualBoundingBoxDescent) / REFERENCE_FONT_PX
		),
		contentEm: round((body.fontBoundingBoxAscent + body.fontBoundingBoxDescent) / REFERENCE_FONT_PX)
	};
	measurementCache.set(key, bearings);
	return bearings;
}
