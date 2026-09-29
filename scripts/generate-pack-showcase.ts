/**
 * Write the Pack colour and type data docs.gfx.computer/packs prints.
 *
 *   pnpm gen:pack-showcase
 *
 * The docs site is a separate build that cannot import the engine's `$lib`
 * graph, so the derivation in `src/lib/platform/packs/pack-showcase.ts` is run
 * here and its result published as `docs-site/src/lib/pack-showcase.json`.
 * Nothing on that page is transcribed by hand:
 * `src/lib/platform/packs/pack-showcase.test.ts` fails when the published file
 * and the Pack manifests disagree, so run this after changing a manifest.
 *
 * The stills beside the swatches come from `pnpm capture:pack-dresses`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
registerGfxRuntimeModuleHooks(repoRoot);

const showcaseModule = await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/pack-showcase.ts')).href
);
const derivePackShowcaseCatalog = showcaseModule.derivePackShowcaseCatalog as () => unknown;
const frameSpec = showcaseModule.PACK_SHOWCASE_FRAME_SPEC as { presetSlug: string };

const publishedPath = resolve(repoRoot, 'docs-site/src/lib/pack-showcase.json');
const document = {
	presetSlug: frameSpec.presetSlug,
	packs: derivePackShowcaseCatalog()
};
writeFileSync(publishedPath, `${JSON.stringify(document, null, '\t')}\n`);
console.log(`Wrote ${publishedPath}`);
