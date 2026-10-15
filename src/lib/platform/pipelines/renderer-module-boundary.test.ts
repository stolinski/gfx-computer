import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it } from 'vite-plus/test';

const SOURCE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LIB_ROOT = resolve(SOURCE_ROOT, 'lib');

function readSource(relativeUrl: string): string {
	return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

function scriptSource(file: string): string {
	const source = readFileSync(file, 'utf8');
	if (!file.endsWith('.svelte')) return source;
	return source.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)?.[1] ?? '';
}

function runtimeImportSpecifiers(file: string): string[] {
	const source = scriptSource(file);
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const specifiers: string[] = [];
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			const clause = statement.importClause;
			if (clause?.isTypeOnly) continue;
			if (
				clause?.namedBindings &&
				ts.isNamedImports(clause.namedBindings) &&
				!clause.name &&
				clause.namedBindings.elements.every((element) => element.isTypeOnly)
			) {
				continue;
			}
			specifiers.push(statement.moduleSpecifier.text);
			continue;
		}
		if (
			ts.isExportDeclaration(statement) &&
			statement.moduleSpecifier &&
			ts.isStringLiteral(statement.moduleSpecifier)
		) {
			if (statement.isTypeOnly) continue;
			if (
				statement.exportClause &&
				ts.isNamedExports(statement.exportClause) &&
				statement.exportClause.elements.every((element) => element.isTypeOnly)
			) {
				continue;
			}
			specifiers.push(statement.moduleSpecifier.text);
		}
	}
	return specifiers;
}

function resolveSourceImport(importer: string, specifier: string): string | null {
	let base: string;
	if (specifier.startsWith('$lib/')) base = resolve(LIB_ROOT, specifier.slice('$lib/'.length));
	else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier);
	else return null;
	if (/\.(json|css|wav|png|jpg|webp|woff2?)$/.test(base)) return null;
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.svelte.ts`,
		`${base}.server.ts`,
		`${base}.svelte`,
		resolve(base, 'index.ts')
	]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

function collectRuntimeImportGraph(entries: string[]): Set<string> {
	const graph = new Set<string>();
	const pending = [...entries];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file || graph.has(file)) continue;
		graph.add(file);
		for (const specifier of runtimeImportSpecifiers(file)) {
			const dependency = resolveSourceImport(file, specifier);
			if (dependency && !graph.has(dependency)) pending.push(dependency);
		}
	}
	return graph;
}

const RENDERER_FREE_PIPELINE_SUPPORT_MODULES = new Set([
	'overlays/achievement/achievement-content.ts',
	'overlays/achievement/achievement-motion.ts',
	'overlays/achievement/achievement-style.ts',
	'overlays/counter/variants/variant-ids.ts',
	'overlays/cursor-trail/schedule.ts',
	'overlays/icon-orbit/icons.ts',
	'overlays/instance-stack/variants/variant-ids.ts',
	'overlays/lower-third/variants/variant-ids.ts',
	'overlays/shader-fill/shader-fill-defaults.ts',
	'overlays/text-3d/variants/variant-ids.ts',
	'overlays/tweet-stack/tweet-stack-content.ts',
	'overlays/washi-tape/washi-tape-defaults.ts',
	'surfaces/checklist/schedule.ts',
	'surfaces/imessage/schedule.ts',
	'surfaces/newspaper/newsprint-substrate.ts',
	'surfaces/paper/paper-substrate.ts',
	'surfaces/type-hero/variants/variant-ids.ts'
]);

function rendererImplementationModules(graph: ReadonlySet<string>): string[] {
	const pipelineFamilyMarker = '/lib/pipelines/';
	return [...graph].filter((file) => {
		const markerIndex = file.indexOf(pipelineFamilyMarker);
		if (markerIndex < 0) return false;
		const relativePath = file.slice(markerIndex + pipelineFamilyMarker.length);
		if (!/^(surfaces|blocks|annotations|overlays|effects)\//.test(relativePath)) return false;
		return (
			!relativePath.endsWith('/definition.ts') &&
			!relativePath.endsWith('/identity.ts') &&
			!RENDERER_FREE_PIPELINE_SUPPORT_MODULES.has(relativePath)
		);
	});
}

function typeGpuRuntimeImports(graph: ReadonlySet<string>): string[] {
	return [...graph].flatMap((file) =>
		runtimeImportSpecifiers(file)
			.filter((specifier) => specifier === 'typegpu' || specifier.startsWith('typegpu/'))
			.map((specifier) => `${file}: ${specifier}`)
	);
}

function assertRendererFreeGraph(graph: ReadonlySet<string>): void {
	assert.deepEqual(rendererImplementationModules(graph), []);
	assert.deepEqual(
		[...graph].filter((file) => file.endsWith('.svelte')),
		[]
	);
	assert.deepEqual(
		[...graph].filter((file) => file.endsWith('/pipelines/runtime-loader.ts')),
		[]
	);
	assert.deepEqual(typeGpuRuntimeImports(graph), []);
}

describe('renderer module boundary', () => {
	it('keeps SurfaceMount isolated from concrete renderer hot updates', () => {
		const surfaceMount = fileURLToPath(new URL('../SurfaceMount.svelte', import.meta.url));
		const graph = collectRuntimeImportGraph([surfaceMount]);

		assert.ok([...graph].some((file) => file.endsWith('/pipelines/runtime-context.svelte.ts')));
		assert.deepEqual(rendererImplementationModules(graph), []);
	});

	it('classifies every non-allowlisted Pipeline-family implementation module as runtime code', () => {
		const root = '/repo/src/lib/pipelines/';
		assert.deepEqual(
			rendererImplementationModules(
				new Set([
					`${root}surfaces/paper/definition.ts`,
					`${root}surfaces/paper/paper-substrate.ts`,
					`${root}surfaces/paper/pipeline.ts`,
					`${root}surfaces/paper/render-helper.ts`,
					`${root}overlays/lower-third/CanvasSource.svelte`,
					`${root}effects/water/index.ts`
				])
			).toSorted(),
			[
				`${root}effects/water/index.ts`,
				`${root}overlays/lower-third/CanvasSource.svelte`,
				`${root}surfaces/paper/pipeline.ts`,
				`${root}surfaces/paper/render-helper.ts`
			]
		);
	});

	it('keeps the preset route transitive initial graph free of concrete renderers', () => {
		const route = fileURLToPath(new URL('../../../routes/p/[slug]/+page.svelte', import.meta.url));
		const graph = collectRuntimeImportGraph([route]);

		assert.deepEqual(rendererImplementationModules(graph), []);
		assert.ok([...graph].some((file) => file.endsWith('/pipelines/runtime-loader.ts')));
		assert.doesNotMatch(readSource('./runtime-loader.ts'), /from ['"]\$lib\/pipelines\//);
		assert.match(
			readSource('./runtime-loader.ts'),
			/\(\) =>\s*import\('\$lib\/pipelines\/effects\/water'\)/
		);
	});

	it('keeps the transitive definition graph free of renderer implementations and runtimes', () => {
		const registry = fileURLToPath(new URL('./definition-registry.ts', import.meta.url));
		const graph = collectRuntimeImportGraph([registry]);
		const pipelineRoot = fileURLToPath(new URL('../../pipelines/', import.meta.url));
		const definitionFiles: string[] = [];
		for (const layer of ['surfaces', 'blocks', 'annotations', 'overlays', 'effects']) {
			const layerRoot = `${pipelineRoot}/${layer}`;
			for (const family of readdirSync(layerRoot, { withFileTypes: true })) {
				if (family.isDirectory()) definitionFiles.push(`${layerRoot}/${family.name}/definition.ts`);
			}
		}

		assert.ok(definitionFiles.length > 50);
		assertRendererFreeGraph(graph);
	});

	it('keeps both server page graphs on the renderer-free Preset catalog', () => {
		const homepageServer = fileURLToPath(
			new URL('../../../routes/+page.server.ts', import.meta.url)
		);
		const presetServer = fileURLToPath(
			new URL('../../../routes/p/[slug]/+page.server.ts', import.meta.url)
		);
		const graph = collectRuntimeImportGraph([homepageServer, presetServer]);

		assert.ok([...graph].some((file) => file.endsWith('/platform/preset-catalog.ts')));
		assert.deepEqual(
			[...graph].filter((file) => file.endsWith('/platform/preset.ts')),
			[]
		);
		assert.equal(
			[...graph].some((file) => file.includes('engine-state.svelte')),
			false
		);
		assertRendererFreeGraph(graph);
	});
});
