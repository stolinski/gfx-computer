/**
 * ADR-0068 §3 store migration: re-key every stored User composition whose slug
 * equals a corpus Preset slug.
 *
 * The retired fork-on-edit model stored an edited Starter under the Starter's
 * own slug. `/p/<slug>` now always shows the pristine Starter and the store
 * refuses to write under a corpus slug, so each such record is moved to the
 * first free `<slug>-2`, `<slug>-3`, … as a `{ meta, film }` record, and the
 * old file goes to the store's trash. Nothing is deleted. A second run is a
 * no-op.
 *
 * This script takes NO backup. Back the store up before running it without
 * `--dry-run`.
 *
 * Usage:
 *   npx tsx scripts/migrate-user-composition-shadow-records.ts <store-directory> --dry-run
 *   npx tsx scripts/migrate-user-composition-shadow-records.ts <store-directory>
 *
 * Both print the report as JSON: `moves` (planned under `--dry-run`, done
 * otherwise) and `skipped` (records left in place, each with its reason).
 */
import { readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
	UserCompositionShadowRecordMigrationReport,
	UserCompositionShadowRecordMigrationRequest
} from '../src/lib/platform/user-composition-shadow-record-migration.server';

// Preset validation reaches modules Vite resolves and Node/tsx cannot load:
// the Pack manifests import @fontsource side-effect stylesheets, and the
// capture and media registries import bundled images, video, and fonts. Stub
// `.css` as an empty module and every other static asset as its own URL — the
// migration reads composition documents, never asset bytes.
const STATIC_ASSET_MODULE_PATTERN =
	/\.(png|jpe?g|webp|avif|gif|svg|mp4|webm|mov|wav|mp3|woff2?|ttf|otf|glb|stagemesh|stageglyphs)(\?.*)?$/;

registerHooks({
	load(url, context, nextLoad) {
		if (url.endsWith('.css')) {
			return { format: 'module', source: '', shortCircuit: true };
		}
		if (STATIC_ASSET_MODULE_PATTERN.test(url)) {
			return {
				format: 'module',
				source: `export default ${JSON.stringify(url)};`,
				shortCircuit: true
			};
		}
		return nextLoad(url, context);
	}
});

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const corpusPresetDirectory = resolve(repoRoot, 'src/lib/presets');
const migrationModulePath = resolve(
	repoRoot,
	'src/lib/platform/user-composition-shadow-record-migration.server.ts'
);

const DRY_RUN_FLAG = '--dry-run';
const commandArguments = process.argv.slice(2);
const dryRun = commandArguments.includes(DRY_RUN_FLAG);
const positionalArguments = commandArguments.filter((argument) => !argument.startsWith('--'));
const unknownFlags = commandArguments.filter(
	(argument) => argument.startsWith('--') && argument !== DRY_RUN_FLAG
);

if (positionalArguments.length !== 1 || unknownFlags.length > 0) {
	console.error(
		`Usage: npx tsx scripts/migrate-user-composition-shadow-records.ts <store-directory> [${DRY_RUN_FLAG}]`
	);
	process.exit(2);
}

// A corpus Preset's slug is its file name, as `preset-catalog.ts` reads it.
const corpusSlugs = (await readdir(corpusPresetDirectory))
	.filter((entry) => entry.endsWith('.json'))
	.map((entry) => entry.slice(0, -'.json'.length));

const { migrateUserCompositionShadowRecords } = (await import(
	pathToFileURL(migrationModulePath).href
)) as {
	migrateUserCompositionShadowRecords: (
		request: UserCompositionShadowRecordMigrationRequest
	) => Promise<UserCompositionShadowRecordMigrationReport>;
};

try {
	const report = await migrateUserCompositionShadowRecords({
		storeDirectory: resolve(positionalArguments[0]),
		corpusSlugs,
		dryRun
	});
	console.log(JSON.stringify(report, null, 2));
} catch (cause) {
	console.error(cause instanceof Error ? cause.message : cause);
	process.exit(1);
}
