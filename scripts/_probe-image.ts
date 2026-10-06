import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PNG } from 'pngjs';

export interface ProbeRegion {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ProbeBounds {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

interface ParseProbeArgsOptions {
	region: 'optional' | 'required';
	downsample?: boolean;
	usage: string;
}

export function parseProbeArgs({
	region: regionRequirement,
	downsample: allowDownsample,
	usage
}: ParseProbeArgsOptions): {
	pngPath: string;
	region: ProbeRegion | null;
	downsample: number | null;
} {
	const [, , inputPath, ...rest] = process.argv;
	if (!inputPath) {
		console.error(usage);
		process.exit(2);
	}

	let region: ProbeRegion | null = null;
	const regionIndex = rest.indexOf('--region');
	if (regionIndex >= 0) {
		const value = rest[regionIndex + 1];
		if (!value) {
			console.error('--region requires x,y,w,h');
			process.exit(2);
		}

		const [x, y, w, h] = value.split(',').map((part) => Number(part));
		if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
			console.error(`invalid region "${value}"`);
			process.exit(2);
		}
		region = { x, y, w, h };
	}

	if (regionRequirement === 'required' && !region) {
		console.error(usage);
		process.exit(2);
	}

	let downsampleFactor: number | null = null;
	const downsampleIndex = rest.indexOf('--downsample');
	if (downsampleIndex >= 0) {
		if (!allowDownsample) {
			console.error(usage);
			process.exit(2);
		}
		const value = Number(rest[downsampleIndex + 1]);
		if (!Number.isInteger(value) || value < 2 || value > 16) {
			console.error('--downsample requires an integer factor in [2, 16]');
			process.exit(2);
		}
		downsampleFactor = value;
	}

	return { pngPath: resolve(process.cwd(), inputPath), region, downsample: downsampleFactor };
}

export async function loadProbePng(pngPath: string): Promise<PNG> {
	return PNG.sync.read(await readFile(pngPath));
}

/**
 * Box-average the image down by an integer factor (RGBA mean per block).
 * Simulates viewing distance: subpixel structure painted by mask-class
 * Effects (CRT triads, scanlines, NTSC chroma fringing) blends into the
 * perceptual colour it reads as, instead of being measured per-pixel.
 */
export function downsampleProbePng(png: PNG, factor: number): PNG {
	const width = Math.max(1, Math.floor(png.width / factor));
	const height = Math.max(1, Math.floor(png.height / factor));
	const out = new PNG({ width, height });

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			let count = 0;
			const sourceYEnd = Math.min(png.height, (y + 1) * factor);
			const sourceXEnd = Math.min(png.width, (x + 1) * factor);
			for (let sourceY = y * factor; sourceY < sourceYEnd; sourceY++) {
				for (let sourceX = x * factor; sourceX < sourceXEnd; sourceX++) {
					const i = (sourceY * png.width + sourceX) * 4;
					r += png.data[i];
					g += png.data[i + 1];
					b += png.data[i + 2];
					a += png.data[i + 3];
					count++;
				}
			}
			const o = (y * width + x) * 4;
			out.data[o] = Math.round(r / count);
			out.data[o + 1] = Math.round(g / count);
			out.data[o + 2] = Math.round(b / count);
			out.data[o + 3] = Math.round(a / count);
		}
	}

	return out;
}

export function getProbeBounds(png: PNG, region: ProbeRegion | null): ProbeBounds {
	return {
		x0: region ? Math.max(0, region.x) : 0,
		y0: region ? Math.max(0, region.y) : 0,
		x1: region ? Math.min(png.width, region.x + region.w) : png.width,
		y1: region ? Math.min(png.height, region.y + region.h) : png.height
	};
}

/**
 * Every region given for a repeatable flag (for example `--exclude-region`),
 * in argument order. Each value is `x,y,w,h` with a positive size.
 */
export function parseRepeatedProbeRegions(flag: string): ProbeRegion[] {
	const regions: ProbeRegion[] = [];
	process.argv.forEach((argument, index) => {
		if (argument !== flag) return;
		const [x, y, w, h] = (process.argv[index + 1] ?? '').split(',').map(Number);
		if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
			throw new TypeError(`${flag} requires x,y,w,h`);
		}
		regions.push({ x, y, w, h });
	});
	return regions;
}
