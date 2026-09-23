import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	PACK_SHOWCASE_FRAME_SPEC,
	derivePackShowcase,
	derivePackShowcaseCatalog
} from './pack-showcase';
import { PACK_REGISTRY, PACK_REGISTRY_SLUGS } from './registry';

/** What `pnpm gen:pack-showcase` publishes for the docs site to print. */
const PUBLISHED_SHOWCASE_PATH = resolve(process.cwd(), 'docs-site/src/lib/pack-showcase.json');
const PACK_STILL_DIRECTORY = resolve(process.cwd(), 'docs-site/static/pack-stills');

describe('Pack showcase', () => {
	it('takes every swatch hex straight off the Pack manifest', () => {
		for (const slug of PACK_REGISTRY_SLUGS) {
			const manifest = PACK_REGISTRY[slug];
			const { swatches } = derivePackShowcase(manifest);
			expect(swatches.map((swatch) => swatch.role)).toEqual([
				'field-treatment',
				'fill-treatment',
				'ink-treatment',
				'accent-treatment'
			]);
			for (const swatch of swatches) {
				expect(manifest.roles[swatch.role], `${slug} → ${swatch.role}`).toEqual({
					kind: 'style',
					value: swatch.hex
				});
			}
		}
	});

	it('names the first family of each type voice a Pack claims', () => {
		expect(derivePackShowcase(PACK_REGISTRY.syntax).faces).toEqual([
			{ role: 'font-treatment', use: 'Display', family: 'Space Grotesk' },
			{ role: 'font-label-treatment', use: 'Labels', family: 'Space Mono' }
		]);
		// crt-terminal drives one mono voice everywhere and sets no label core.
		expect(derivePackShowcase(PACK_REGISTRY['crt-terminal']).faces).toEqual([
			{ role: 'font-treatment', use: 'Display', family: 'JetBrains Mono' }
		]);
	});

	it('publishes exactly what the manifests say', () => {
		const published: unknown = JSON.parse(readFileSync(PUBLISHED_SHOWCASE_PATH, 'utf-8'));
		expect(
			published,
			'docs-site/src/lib/pack-showcase.json is stale — run `pnpm gen:pack-showcase`'
		).toEqual({
			presetSlug: PACK_SHOWCASE_FRAME_SPEC.presetSlug,
			packs: derivePackShowcaseCatalog()
		});
	});

	it('has a captured still for every registered Pack', () => {
		const framePresetPath = `src/lib/presets/${PACK_SHOWCASE_FRAME_SPEC.presetSlug}.json`;
		expect(existsSync(resolve(process.cwd(), framePresetPath)), framePresetPath).toBe(true);
		for (const slug of PACK_REGISTRY_SLUGS) {
			expect(
				existsSync(resolve(PACK_STILL_DIRECTORY, `${slug}.webp`)),
				`${slug} has no still — run \`pnpm capture:pack-dresses\``
			).toBe(true);
		}
	});
});
