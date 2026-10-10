import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('$lib/')) {
			const base = resolve(repoRoot, 'src/lib', specifier.slice('$lib/'.length));
			for (const candidate of [`${base}.ts`, resolve(base, 'index.ts'), base]) {
				if (existsSync(candidate))
					return { url: pathToFileURL(candidate).href, shortCircuit: true };
			}
		}
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
				const base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
				for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
					if (existsSync(candidate)) {
						return { url: pathToFileURL(candidate).href, shortCircuit: true };
					}
				}
			}
			throw error;
		}
	},
	load(url, context, nextLoad) {
		if (url.endsWith('/engine-state.svelte.ts')) {
			return {
				format: 'module',
				source: "export const engineState = {}; export const packState = { slug: 'syntax' };",
				shortCircuit: true
			};
		}
		if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
		if (url.endsWith('.svelte')) {
			return { format: 'module', source: 'export default {};', shortCircuit: true };
		}
		if (/\.(png|jpe?g|webp|woff2?|wav)$/.test(url)) {
			return {
				format: 'module',
				source: `export default ${JSON.stringify(url)};`,
				shortCircuit: true
			};
		}
		return nextLoad(url, context);
	}
});
(globalThis as typeof globalThis & { $state: <T>(value: T) => T }).$state = <T>(value: T): T =>
	value;

const { PACK_REGISTRY } = await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/registry.ts')).href
);
const { validatePackManifest, validatePackRegistry } = await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/packs/validation.ts')).href
);

function clonePack() {
	return structuredClone(PACK_REGISTRY['clean-light']);
}

function expectIssue(mutate: (pack: ReturnType<typeof clonePack>) => void, kind: string): void {
	const pack = clonePack();
	mutate(pack);
	const issues = validatePackManifest('clean-light', pack);
	assert.ok(
		issues.some((issue) => issue.kind === kind),
		`Expected ${kind}, got:\n${issues.map((issue) => `${issue.kind}: ${issue.message}`).join('\n')}`
	);
}

assert.deepEqual(validatePackRegistry(PACK_REGISTRY), []);

{
	const pack = clonePack();
	pack.slug = 'wrong';
	const issues = validatePackManifest('clean-light', pack);
	assert.ok(issues.some((issue) => issue.kind === 'registry-slug-mismatch'));
}

expectIssue((pack) => {
	pack.label = ' ';
}, 'invalid-metadata');

expectIssue((pack) => {
	delete pack.roles['fill-treatment'];
}, 'invalid-core-role');

expectIssue((pack) => {
	delete pack.roles['field-treatment'];
}, 'invalid-core-role');

expectIssue((pack) => {
	pack.roles['field-ink-treatment'] = { kind: 'style', value: 'not-a-color' };
}, 'invalid-pack-role-value');

for (const malformed of ['#12345', '#1234567', 'rgb(', 'rgb(bogus)']) {
	expectIssue((pack) => {
		pack.roles['field-treatment'] = { kind: 'style', value: malformed };
	}, 'invalid-pack-role-value');
}

expectIssue((pack) => {
	pack.roles['chapter-card.backdrop'] = {
		kind: 'style',
		value: { top: 'rgba(0, 0, 0, 0.5)', bottom: '#111', light: '#222' }
	};
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['highlight.fill'] = { kind: 'style', value: 'currentColor' };
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['lower-third.kicker'] = {
		kind: 'style',
		value: { form: 'chip', plate: 'bogus', ink: 'bogus' }
	};
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['invented.border'] = { kind: 'style', value: '1px solid red' };
}, 'unknown-pack-role');

expectIssue((pack) => {
	pack.roles['fill-treatment'] = { kind: 'chrome', effects: [] };
}, 'wrong-pack-role-kind');

expectIssue((pack) => {
	pack.roles['plain.edge'] = { kind: 'style', value: 'sharp' };
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['plain.depth'] = { kind: 'style', value: 'flat' };
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['chapter-card.backdrop'] = {
		kind: 'style',
		value: { top: '#000', bottom: '#111', light: 'not-a-color' }
	};
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['cursor-trail.pointer'] = { kind: 'style', value: 'wand' };
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['cursor-trail.pointer'] = {
		kind: 'style',
		value: { toString: () => 'mac-pointer' }
	};
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['diagram.stroke'] = { kind: 'style', value: { color: 'ink', widthPx: -1 } };
}, 'invalid-pack-role-value');

expectIssue((pack) => {
	pack.roles['font-treatment'] = { kind: 'style', value: "'Missing Face', sans-serif" };
}, 'undeclared-font-family');

expectIssue((pack) => {
	pack.fonts = [{ family: 'Geist', weights: [400, 400] }];
}, 'invalid-font-declaration');

expectIssue((pack) => {
	pack.roles['surface-choice'] = { kind: 'pipeline', pipeline: 'paper' };
}, 'unsupported-pipeline-role');

expectIssue((pack) => {
	pack.roles.chrome = { kind: 'chrome', effects: [{ type: 'missing', params: {} }] };
}, 'unknown-chrome-effect');

expectIssue((pack) => {
	pack.roles.chrome = {
		kind: 'chrome',
		effects: [{ type: 'paper-grain', params: { warmth: 2, density: 0.3 } }]
	};
}, 'invalid-chrome-effect');

expectIssue((pack) => {
	pack.roles.chrome = {
		kind: 'chrome',
		effects: [
			{ type: 'paper-grain', params: { warmth: 0.5, density: 0.3 } },
			{ type: 'paper-grain', params: { warmth: 0.5, density: 0.3 } }
		]
	};
}, 'duplicate-chrome-effect');

console.log('test-pack-validation.ts: all assertions passed');
