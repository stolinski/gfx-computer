import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';

// The hosted build (PUBLIC_GFX_HOSTED, see svelte.config.js) bundles the whole
// server tree into one Worker, including the development-only routes the
// hosted origin answers 404 for before they load. Playwright is the one import
// in that tree a Worker can neither bundle nor run, so the hosted build resolves
// it to a stand-in that names the origin with the capability instead.
const isHostedBuild = (process.env.PUBLIC_GFX_HOSTED ?? '').trim() !== '';
const playwrightAbsentOnHostedOrigin = fileURLToPath(
	new URL('./src/lib/platform/playwright-absent-on-hosted-origin.server.ts', import.meta.url)
);

export default defineConfig(({ mode }) => ({
	lint: {
		plugins: ['typescript'],
		jsPlugins: [
			{
				name: 'vite-plus',
				specifier: 'vite-plus/oxlint-plugin'
			}
		],
		// Retain the migrated rules, without adding unrelated lint policy.
		categories: { correctness: 'off' },
		env: {
			builtin: true,
			browser: true,
			node: true
		},
		ignorePatterns: [
			'**/node_modules',
			'**/.output',
			'**/.vercel',
			'**/.netlify',
			'**/.wrangler',
			'.svelte-kit',
			'build',
			'**/.DS_Store',
			'**/Thumbs.db',
			'**/.env',
			'**/.env.*',
			'!**/.env.example',
			'!**/.env.test',
			'**/vite.config.js.timestamp-*',
			'**/vite.config.ts.timestamp-*',
			'.tmp-baselines',
			'.tmp-critique',
			'docs/release-acceptance-manifest.json',
			'**/.test-snapshots',
			'user-compositions',
			'user-assets',
			'.posters',
			'static/backdrops',
			'.dex/swamp-repository-write.lock',
			'**/.swamp/',
			'**/.swamp-sources.yaml',
			'.claude/worktrees/',
			'.claude/settings.local.json',
			'.claude/scheduled_tasks.lock',
			'.claude/scheduled_tasks.json',
			'.prime/agent/telemetry/',
			'docs-site/**',
			// ESLint retains the script + template rules for Svelte components.
			'**/*.svelte'
		],
		rules: {
			'constructor-super': 'error',
			'for-direction': 'error',
			'getter-return': 'error',
			'no-async-promise-executor': 'error',
			'no-case-declarations': 'error',
			'no-class-assign': 'error',
			'no-compare-neg-zero': 'error',
			'no-cond-assign': 'error',
			'no-const-assign': 'error',
			'no-constant-binary-expression': 'error',
			'no-constant-condition': 'error',
			'no-control-regex': 'error',
			'no-debugger': 'error',
			'no-delete-var': 'error',
			'no-dupe-class-members': 'error',
			'no-dupe-else-if': 'error',
			'no-dupe-keys': 'error',
			'no-duplicate-case': 'error',
			'no-empty': ['error', { allowEmptyCatch: true }],
			'no-empty-character-class': 'error',
			'no-empty-pattern': 'error',
			'no-empty-static-block': 'error',
			'no-ex-assign': 'error',
			'no-extra-boolean-cast': 'error',
			'no-fallthrough': 'error',
			'no-func-assign': 'error',
			'no-global-assign': 'error',
			'no-import-assign': 'error',
			'no-invalid-regexp': 'error',
			'no-irregular-whitespace': 'error',
			'no-loss-of-precision': 'error',
			'no-misleading-character-class': 'error',
			'no-new-native-nonconstructor': 'error',
			'no-nonoctal-decimal-escape': 'error',
			'no-obj-calls': 'error',
			'no-prototype-builtins': 'error',
			'no-redeclare': 'error',
			'no-regex-spaces': 'error',
			'no-self-assign': 'error',
			'no-setter-return': 'error',
			'no-shadow-restricted-names': 'error',
			'no-sparse-arrays': 'error',
			'no-this-before-super': 'error',
			'no-unassigned-vars': 'error',
			'no-undef': 'off',
			'no-unexpected-multiline': 'error',
			'no-unreachable': 'error',
			'no-unsafe-finally': 'error',
			'no-unsafe-negation': 'error',
			'no-unsafe-optional-chaining': 'error',
			'no-unused-labels': 'error',
			'no-unused-private-class-members': 'error',
			'no-unused-vars': 'error',
			'no-useless-assignment': 'error',
			'no-useless-backreference': 'error',
			'no-useless-catch': 'error',
			'no-useless-escape': 'error',
			'no-with': 'error',
			'preserve-caught-error': 'error',
			'require-yield': 'error',
			'use-isnan': 'error',
			'valid-typeof': 'error',
			'no-array-constructor': 'error',
			'no-unused-expressions': 'error',
			'typescript/ban-ts-comment': 'error',
			'typescript/no-duplicate-enum-values': 'error',
			'typescript/no-empty-object-type': 'error',
			'typescript/no-explicit-any': 'error',
			'typescript/no-extra-non-null-assertion': 'error',
			'typescript/no-misused-new': 'error',
			'typescript/no-namespace': 'error',
			'typescript/no-non-null-asserted-optional-chain': 'error',
			'typescript/no-require-imports': 'error',
			'typescript/no-this-alias': 'error',
			'typescript/no-unnecessary-type-constraint': 'error',
			'typescript/no-unsafe-declaration-merging': 'error',
			'typescript/no-unsafe-function-type': 'error',
			'typescript/no-wrapper-object-types': 'error',
			'typescript/prefer-as-const': 'error',
			'typescript/prefer-namespace-keyword': 'error',
			'typescript/triple-slash-reference': 'error',
			'vite-plus/prefer-vite-plus-imports': 'error'
		},
		overrides: [
			{
				files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
				rules: {
					'constructor-super': 'off',
					'getter-return': 'off',
					'no-class-assign': 'off',
					'no-const-assign': 'off',
					'no-dupe-class-members': 'off',
					'no-dupe-keys': 'off',
					'no-func-assign': 'off',
					'no-import-assign': 'off',
					'no-new-native-nonconstructor': 'off',
					'no-obj-calls': 'off',
					'no-redeclare': 'off',
					'no-setter-return': 'off',
					'no-this-before-super': 'off',
					'no-undef': 'off',
					'no-unreachable': 'off',
					'no-unsafe-negation': 'off',
					'no-var': 'error',
					'no-with': 'off',
					'prefer-const': 'error',
					'prefer-rest-params': 'error',
					'prefer-spread': 'error'
				}
			},
			{
				files: ['**/*.svelte.ts', '**/*.svelte.js'],
				rules: {
					'no-restricted-globals': [
						'error',
						{
							name: 'structuredClone',
							message:
								'structuredClone throws on Svelte $state proxies; use $state.snapshot(value) in Svelte files.'
						}
					]
				},
				globals: {
					$state: 'readonly',
					$derived: 'readonly',
					$effect: 'readonly',
					$props: 'readonly',
					$bindable: 'readonly',
					$inspect: 'readonly',
					$host: 'readonly'
				}
			}
		],
		options: {
			// svelte-check owns the single native, incremental TypeScript program.
			typeAware: false,
			typeCheck: false
		}
	},
	// Native Vite Task caching replaces the former whole-worktree suite stamp.
	run: {
		tasks: {
			'check:types': {
				command: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --tsgo --incremental',
				cache: {
					env: ['NODE_ENV', 'PUBLIC_GFX_*', 'GFX_*'],
					input: [{ auto: true }, '!.svelte-kit/**'],
					// Sync/compiler artifacts only, never built Node or Worker output.
					output: [
						'.svelte-kit/*.d.ts',
						'.svelte-kit/tsconfig.json',
						'.svelte-kit/types/**',
						'.svelte-kit/generated/**',
						'.svelte-kit/.svelte-check/**'
					]
				}
			},
			'lint:app': {
				command: 'vp lint && eslint "**/*.svelte"',
				cache: { output: [] }
			},
			'check:policy': {
				command:
					'node scripts/check-discoverability.mjs && node scripts/check-legacy-name-dispositions.mjs && node scripts/check-verification-spawn-hygiene.mjs',
				cache: { output: [] }
			},
			'test:unit': {
				command: 'vp test run --project node --project dom',
				cache: { env: ['NODE_ENV', 'PUBLIC_GFX_*', 'GFX_*'], output: [] }
			}
		}
	},
	// Formatting stays explicit, as it was before migration.
	check: { fmt: false },
	fmt: {
		useTabs: true,
		singleQuote: true,
		trailingComma: 'none',
		printWidth: 100,
		sortPackageJson: false,
		svelte: {},
		ignorePatterns: [
			'package-lock.json',
			'pnpm-lock.yaml',
			'yarn.lock',
			'bun.lock',
			'bun.lockb',
			'/static/',
			'src/lib/platform/google-fonts-catalog.json'
		]
	},
	plugins: lazyPlugins(() => [sveltekit()]),
	...(isHostedBuild ? { resolve: { alias: { playwright: playwrightAbsentOnHostedOrigin } } } : {}),
	...(mode === 'test'
		? {}
		: {
				// Package-root exclusions also cover deep imports such as svelte/reactivity.
				// Keep Svelte out of changing SSR prebundles while the dev server is running.
				ssr: {
					optimizeDeps: {
						exclude: ['svelte']
					}
				}
			}),
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'node',
					include: ['src/**/*.test.ts', 'vite.config.test.ts'],
					exclude: ['**/node_modules/**', 'src/**/*.dom.test.ts', 'src/**/*.integration.test.ts']
				}
			},
			{
				// Rendered component tests (`*.dom.test.ts`): Svelte's browser build
				// under jsdom, with rendered components cleaned up between tests. The
				// browser condition stays inside this project — applied globally it
				// resolves browser-only builds (Sentry's `$app` client) into Node tests.
				extends: true,
				resolve: { conditions: ['browser', 'module', 'development|production', 'node'] },
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['src/**/*.dom.test.ts'],
					setupFiles: ['@testing-library/svelte/vitest']
				}
			},
			{
				// Real browser and ffmpeg/ffprobe cases are explicit, not UI-edit prerequisites.
				extends: true,
				test: { name: 'integration', include: ['src/**/*.integration.test.ts'] }
			}
		]
	},
	server: {
		port: 7263,
		// Bind every interface family: Caddy dials localhost per-family, and a
		// fresh Node 25 vite otherwise listens on ::1 only — IPv4 dials then 502.
		host: true,
		allowedHosts: ['.robo.online']
	}
}));
