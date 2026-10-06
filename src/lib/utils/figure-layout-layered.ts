import type { FigurePoint, FigureRect } from './figure-geometry';
import { roundFigurePixel } from './figure-geometry';

export interface FigureLayeredLayout {
	/** Node centers, one row per layer. */
	centers: FigurePoint[][];
	/** Node radius in native pixels. */
	radius: number;
	/** Distance between neighbouring layers along the main axis. */
	layerGap: number;
}

/**
 * Layered layout for a neural network (ADR-0067 §3): layers spaced evenly
 * along the main axis (`right` → x, `down` → y), each layer's nodes centered
 * on the cross axis at one shared pitch so every layer reads on the same grid.
 */
export function layoutFigureLayered(
	layerSizes: readonly number[],
	box: FigureRect,
	direction: 'right' | 'down',
	nodeScale: number
): FigureLayeredLayout {
	const mainLength = direction === 'right' ? box.width : box.height;
	const crossLength = direction === 'right' ? box.height : box.width;
	const largest = Math.max(1, ...layerSizes);
	const layerGap = layerSizes.length > 1 ? mainLength / (layerSizes.length - 1) : 0;
	const pitch = crossLength / largest;
	const radius = roundFigurePixel(
		Math.max(6, Math.min(pitch * 0.34, (layerGap || mainLength) * 0.16) * nodeScale)
	);
	const mainStart = direction === 'right' ? box.x : box.y;
	const crossCenter = direction === 'right' ? box.y + box.height / 2 : box.x + box.width / 2;
	const centers = layerSizes.map((size, layerIndex) => {
		const main = mainStart + layerGap * layerIndex;
		return Array.from({ length: size }, (_, index) => {
			const cross = crossCenter + (index - (size - 1) / 2) * pitch;
			return direction === 'right'
				? { x: roundFigurePixel(main), y: roundFigurePixel(cross) }
				: { x: roundFigurePixel(cross), y: roundFigurePixel(main) };
		});
	});
	return { centers, radius, layerGap };
}
