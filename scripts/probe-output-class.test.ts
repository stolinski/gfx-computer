import { describe, expect, it } from 'vite-plus/test';
import { PNG } from 'pngjs';

import { classifyProbeOutputClass } from './_probe-output-class';

function edgePng(width: number, height: number, alpha: number): PNG {
	const png = new PNG({ width, height });
	for (let offset = 3; offset < png.data.length; offset += 4) png.data[offset] = alpha;
	return png;
}

describe('classifyProbeOutputClass', () => {
	it('requires every edge pixel to be transparent', () => {
		const png = edgePng(4, 3, 0);
		expect(classifyProbeOutputClass(png)).toBe('transparent');
		png.data[((png.height - 1) * png.width + 2) * 4 + 3] = 1;
		expect(classifyProbeOutputClass(png)).toBe('mixed');
	});
});
