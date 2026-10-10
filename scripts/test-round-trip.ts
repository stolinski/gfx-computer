/**
 * Round-trip test (ADR-0032 §5): load every corpus preset, serialize it
 * without making any edits, parse the result, and assert deep-equality with
 * the original. Proves that serializeCompositionState + presetToWireFormat
 * never drops data when the GUI has not touched the composition.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createServer as createViteModuleLoader } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const ingressPath = resolve(repoRoot, 'src/lib/platform/preset-ingress.ts');
const purePath = resolve(repoRoot, 'src/lib/platform/preset-pure.ts');

type StructuralParseResult =
	{ success: true; data: unknown } | { success: false; error: { message: string } };

const { PresetIngressSchema } = (await import(pathToFileURL(ingressPath).href)) as {
	PresetIngressSchema: { safeParse(value: unknown): StructuralParseResult };
};

const { serializeCompositionState, presetToWireFormat } = (await import(
	pathToFileURL(purePath).href
)) as {
	serializeCompositionState: (base: unknown, state: unknown, packSlug: string) => unknown;
	presetToWireFormat: (preset: unknown) => unknown;
};

// Middleware mode creates a Vite transform loader without listening on a port.
// It lets this Node structural gate call the same public semantic boundary used
// by catalog and User composition ingress, including project aliases.
const viteModuleLoader = await createViteModuleLoader({
	root: repoRoot,
	appType: 'custom',
	logLevel: 'error',
	server: { middlewareMode: true, watch: null }
});
const { validatePresetSemantics, formatPresetSemanticIssues } =
	(await viteModuleLoader.ssrLoadModule('/src/lib/platform/preset-validation.ts')) as {
		validatePresetSemantics: (
			preset: unknown
		) => readonly { path: readonly (string | number)[]; message: string }[];
		formatPresetSemanticIssues: (
			issues: readonly { path: readonly (string | number)[]; message: string }[]
		) => string;
	};

const PRESETS_DIR = resolve(repoRoot, 'src/lib/presets');
const files = (await readdir(PRESETS_DIR)).filter((f) => f.endsWith('.json'));

let passed = 0;
let failed = 0;
let firstValid: Record<string, unknown> | null = null;

for (const file of files) {
	const raw = await readFile(resolve(PRESETS_DIR, file), 'utf-8');
	const json: unknown = JSON.parse(raw);

	const result = PresetIngressSchema.safeParse(json);
	if (!result.success) {
		console.error(`SKIP (invalid schema): ${file}  — ${result.error.message}`);
		continue;
	}

	const original = result.data as Record<string, unknown>;
	const originalSemanticIssues = validatePresetSemantics(original);
	if (originalSemanticIssues.length > 0) {
		console.error(
			`FAIL (semantic validation): ${file}\n  ${formatPresetSemanticIssues(originalSemanticIssues)}`
		);
		failed += 1;
		continue;
	}
	firstValid ??= original;

	// Serialize without edits: base = original, state = original.state, pack = original.pack
	const serialized = serializeCompositionState(
		original,
		original['state'],
		original['pack'] as string
	);
	const wire = presetToWireFormat(serialized);
	const reparsed = PresetIngressSchema.safeParse(wire);

	if (!reparsed.success) {
		console.error(`FAIL (reparse error): ${file}\n  ${reparsed.error.message}`);
		failed += 1;
		continue;
	}

	const reparsedSemanticIssues = validatePresetSemantics(reparsed.data as Record<string, unknown>);
	if (reparsedSemanticIssues.length > 0) {
		console.error(
			`FAIL (semantic reparse): ${file}\n  ${formatPresetSemanticIssues(reparsedSemanticIssues)}`
		);
		failed += 1;
		continue;
	}

	const eq = deepEqual(original, reparsed.data as unknown);
	if (!eq) {
		console.error(`FAIL (not equal): ${file}`);
		failed += 1;
	} else {
		console.log(`PASS: ${file}`);
		passed += 1;
	}
}

// Edited-metadata round-trip: the GUI edits name / description / kind through
// presetBase, so serialization must carry a base whose metadata DIFFERS from
// the loaded preset.
if (firstValid) {
	const editedBase = {
		name: 'Edited name',
		description: 'Edited description',
		kind: 'fixture'
	} as const;
	const wire = presetToWireFormat(
		serializeCompositionState(editedBase, firstValid['state'], firstValid['pack'] as string)
	);
	const reparsed = PresetIngressSchema.safeParse(wire);
	const fields = reparsed.success
		? (reparsed.data as { name: string; description?: string; kind: string })
		: null;
	if (
		fields &&
		fields.name === editedBase.name &&
		fields.description === editedBase.description &&
		fields.kind === editedBase.kind
	) {
		console.log('PASS: edited metadata (name/description/kind)');
		passed += 1;
	} else {
		console.error('FAIL: edited metadata did not round-trip', fields);
		failed += 1;
	}

	// Cleared description: an undefined description must serialize as an ABSENT
	// key (the GUI clears the field to undefined, not to '').
	const clearedWire = presetToWireFormat(
		serializeCompositionState(
			{ name: 'No description', kind: 'deliverable' },
			firstValid['state'],
			firstValid['pack'] as string
		)
	) as Record<string, unknown>;
	if (!('description' in clearedWire)) {
		console.log('PASS: cleared description serializes as an absent key');
		passed += 1;
	} else {
		console.error('FAIL: cleared optional metadata leaked into the wire format');
		failed += 1;
	}
}

await viteModuleLoader.close();

console.log(`\n${passed} passed, ${failed} failed out of ${files.length} files`);

if (failed > 0) {
	process.exit(1);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return a === b;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
	}
	if (typeof a === 'object' && typeof b === 'object') {
		const keysA = Object.keys(a as object).sort();
		const keysB = Object.keys(b as object).sort();
		if (keysA.length !== keysB.length) return false;
		if (!keysA.every((k, i) => k === keysB[i])) return false;
		return keysA.every((k) =>
			deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
		);
	}
	return false;
}
