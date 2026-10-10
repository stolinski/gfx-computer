import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function registerGfxRuntimeModuleHooks(repoRoot: string): void {
	registerHooks({
		resolve(specifier, context, nextResolve) {
			if (specifier.startsWith('$lib/')) {
				const base = resolve(repoRoot, 'src/lib', specifier.slice('$lib/'.length));
				for (const candidate of [`${base}.ts`, resolve(base, 'index.ts'), base]) {
					if (existsSync(candidate)) {
						return { url: pathToFileURL(candidate).href, shortCircuit: true };
					}
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
}
