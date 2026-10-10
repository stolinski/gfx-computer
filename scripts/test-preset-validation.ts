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

const { PresetIngressSchema } = await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/preset-ingress.ts')).href
);
const { validatePresetSemantics } = await import(
	pathToFileURL(resolve(repoRoot, 'src/lib/platform/preset-validation.ts')).href
);

function basePreset(): Record<string, unknown> {
	return {
		schema: 'gfx@1',
		pack: 'syntax',
		name: 'Semantic validation test',
		state: {
			transport: { orientation: 'horizontal', durationSeconds: 5, fps: 30, format: 'webm' },
			typography: { fontFamily: 'sans', paperColor: '#ffffff', inkColor: '#000000' },
			marks: { defaults: {}, timings: [] },
			surface: { type: 'paper', content: { body: 'Test body.' } },
			textAnimations: [],
			overlays: [],
			effects: [],
			audioCues: []
		}
	};
}

function parsed(input: Record<string, unknown>) {
	const result = PresetIngressSchema.safeParse(input);
	assert.ok(result.success, result.success ? '' : result.error.message);
	return result.data;
}

function expectSemanticIssue(
	mutate: (input: Record<string, unknown>) => void,
	message: string
): void {
	const input = basePreset();
	mutate(input);
	const issues = validatePresetSemantics(parsed(input));
	assert.ok(
		issues.some((issue) => issue.message.includes(message)),
		`Expected semantic issue containing "${message}", got:\n${issues.map((issue) => issue.message).join('\n')}`
	);
}

assert.deepEqual(validatePresetSemantics(parsed(basePreset())), []);

expectSemanticIssue((input) => {
	input.pack = 'missing';
}, 'Unknown Pack');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).surface = {
		type: 'paper',
		variant: 'pair',
		content: { body: 'Test body.' }
	};
}, 'does not support variants');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).overlays = [
		{ type: 'missing', id: 'overlay', content: {}, position: { anchor: 'center' } }
	];
}, 'Unknown Overlay type');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).surface = {
		type: 'website-screenshot',
		content: { body: '', sourceUrl: 'https://example.com' }
	};
}, 'requires a content-addressed');

{
	const input = basePreset();
	(input.state as Record<string, unknown>).surface = {
		type: 'website-screenshot',
		content: {
			body: '',
			sourceUrl: 'https://example.com',
			imageUrl: `/api/user-assets/${'a'.repeat(64)}.png`
		}
	};
	(input.state as Record<string, unknown>).overlays = [
		{
			type: 'source-url',
			id: 'source',
			content: { url: 'example.com' },
			position: { anchor: 'center' }
		}
	];
	assert.deepEqual(validatePresetSemantics(parsed(input)), []);
}

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).overlays = [
		{ type: 'lower-third', id: 'overlay', content: {}, position: { anchor: 'center' } }
	];
}, 'expected string');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).overlays = [
		{ type: 'watermark', id: 'same', content: { text: 'A' }, position: { anchor: 'center' } },
		{ type: 'watermark', id: 'same', content: { text: 'B' }, position: { anchor: 'center' } }
	];
}, 'Duplicate overlay ID');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).effects = [
		{ type: 'missing', id: 'effect', params: {} }
	];
}, 'Unknown Effect type');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).effects = [
		{ type: 'paper-grain', id: 'grain', params: { warmth: 2, density: 0.3 } }
	];
}, 'Too big');

{
	const input = basePreset();
	(input.state as Record<string, unknown>).effects = [
		{ type: 'depth-of-field', id: 'dof', params: { focusZ: 0.5, aperture: 0.6 } }
	];
	assert.deepEqual(validatePresetSemantics(parsed(input)), []);
}

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).effects = [
		{ type: 'depth-of-field', id: 'dof', params: { focusZ: 2, aperture: 0.6 } }
	];
}, 'Too big');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).effects = [
		{ type: 'mask-wipe', id: 'wipe', params: {} }
	];
}, 'belongs in the top-level transition block');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).stage = { type: 'missing' };
}, 'Unknown Stage type');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).stage = {
		type: 'depth',
		backdrop: { image: { asset: 'missing' } }
	};
}, 'Unknown substrate asset');

expectSemanticIssue((input) => {
	(input.state as Record<string, unknown>).textAnimations = [
		{
			id: 'missing-target',
			target: { kind: 'overlay', overlayId: 'missing', slot: 'title' },
			effect: 'soft-blur-in',
			enter: { start: 0, duration: 0.2, ease: 'smooth' }
		}
	];
}, 'does not match any overlays[].id');

console.log('test-preset-validation.ts: all assertions passed');
