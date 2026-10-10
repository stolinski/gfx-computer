import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerGfxRuntimeModuleHooks } from './gfx-runtime-module-hooks.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
// The boundary union is derived from the transition effect registry, whose
// modules are addressed through `$lib`.
registerGfxRuntimeModuleHooks(repoRoot);
const schemaModulePath = resolve(repoRoot, 'src/lib/platform/film-schema.ts');

const { createFilmFormatJsonSchema } = (await import(pathToFileURL(schemaModulePath).href)) as {
	createFilmFormatJsonSchema: () => Record<string, unknown>;
};

const outputPath = resolve(repoRoot, 'docs/film-format.schema.json');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(createFilmFormatJsonSchema(), null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath}`);
