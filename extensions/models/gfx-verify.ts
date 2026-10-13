/**
 * Deterministic verification runner for GFX Factory work.
 *
 * Runs the repo's own check suites inside an isolated worktree (or any
 * checkout path) and stores a structured per-suite outcome. This is the
 * zero-LLM verification seam the Factory's `verify` stage calls: the method
 * run SUCCEEDS only when every selected suite exits 0, so the Factory's
 * `evidence-recorded {status}` gates route ship-vs-rework deterministically.
 *
 * Suite selection is scoped to the change, not the whole app: pass the work
 * item's `filesChanged` and `deriveVerificationSuites` picks suites
 * deterministically — swamp/meta-only changes run no app suites, extension
 * changes run the deno extension tests, docs-site changes run the docs site's
 * own install + check + build (never the app suites or the preset verifier),
 * and app changes run check + fast tests + structural checks. Preset and
 * render/export verification are explicit authoring commands, never inferred
 * from a generic app change.
 *
 * Deliberately absent: repository-cleanliness preconditions. Verification
 * runs against whatever the worktree contains — a dirty primary checkout or
 * unrelated local state is never an admission failure here.
 *
 * `rebuild_and_smoke` is the Factory's post-integration `serve` seam: after a
 * cherry-pick lands on main it rebuilds the primary checkout's production
 * artifact, restarts the supervised `gfx` project through `local-dev-control`,
 * and proves the live origin serves the landed commit (status, `/api/health`,
 * and the `gfx-release` meta; the client-rendered shell's title is recorded
 * but not asserted) — so gfx.robo.online never silently serves stale main.
 *
 * @module
 */
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({});

const SuiteNameSchema = z.enum([
	"check",
	"test",
	"structural",
	"presets",
	"extensions",
	"docs-site",
]);
type VerificationSuiteName = z.infer<typeof SuiteNameSchema>;

const RunChecksArgumentsSchema = z.object({
	worktreePath: z.string().min(1),
	label: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/),
	filesChanged: z.array(z.string()).optional(),
	suites: z.array(SuiteNameSchema).min(1).optional(),
});

const RebuildAndSmokeArgumentsSchema = z.object({
	repoPath: z.string().min(1),
	projectName: z.string().min(1).regex(/^[a-z0-9-]+$/),
	originUrl: z.string().url(),
});

const SuiteOutcomeSchema = z.object({
	name: SuiteNameSchema,
	exitCode: z.number(),
	passed: z.boolean(),
	durationMs: z.number(),
});

const VerificationSchema = z.object({
	ranAt: z.string(),
	worktreePath: z.string(),
	label: z.string(),
	selection: z.enum(["explicit", "derived", "fallback"]),
	suites: z.array(SuiteOutcomeSchema),
	failedSuites: z.array(SuiteNameSchema),
	passed: z.boolean(),
});

const ServingSmokeSchema = z.object({
	ranAt: z.string(),
	repoPath: z.string(),
	projectName: z.string(),
	originUrl: z.string(),
	landedSha: z.string(),
	buildMs: z.number(),
	restarted: z.boolean(),
	httpStatus: z.number().nullable(),
	healthStatus: z.number().nullable(),
	title: z.string().nullable(),
	servedRelease: z.string().nullable(),
	passed: z.boolean(),
	failure: z.string().nullable(),
});

type SuitePlan = { name: VerificationSuiteName; command: string[] };

// Paths whose changes never affect app runtime behavior: swamp definitions,
// agent skills, and docs — except docs/packs, which feeds pack-catalog
// freshness inside verify-presets' own selector.
const APP_INERT_PREFIXES = [
	"models/",
	"workflows/",
	"vaults/",
	".claude/",
	".github/",
	"docs/",
];

function isAppRelevantPath(path: string): boolean {
	if (path.startsWith("docs/packs/")) return true;
	if (path.startsWith("extensions/")) return false;
	// The docs site has its own suite; it never triggers app check/test/presets.
	if (path.startsWith("docs-site/")) return false;
	return !APP_INERT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function swampDenoPath(): string {
	const home = Deno.env.get("HOME");
	if (!home) throw new Error("HOME is not set; cannot locate ~/.swamp/deno/deno");
	return `${home}/.swamp/deno/deno`;
}

function buildSuiteCommand(
	name: VerificationSuiteName,
	appPaths: string[] | null,
): string[] {
	switch (name) {
		case "check":
			return ["pnpm", "run", "check"];
		case "test":
			return ["pnpm", "run", "test"];
		case "structural":
			return ["pnpm", "run", "test:structural"];
		case "presets":
			return appPaths === null
				? [
					"node",
					"--experimental-strip-types",
					"scripts/verify-presets.ts",
					"--all",
				]
				: [
					"node",
					"--experimental-strip-types",
					"scripts/verify-presets.ts",
					"--affected",
					"--changed-paths-json",
					JSON.stringify(appPaths),
				];
		case "extensions":
			// --allow-env=HOME: the suite under test resolves ~/.swamp/deno/deno.
			return [
				swampDenoPath(),
				"test",
				"--allow-read",
				"--allow-env=HOME",
				"extensions/models/",
			];
		case "docs-site":
			// The docs site is its own npm package (not in the pnpm workspace),
			// so verification installs and checks it in place. The build is the
			// real gate: prerender renders every published doc page.
			return [
				"bash",
				"-c",
				"cd docs-site && npm ci --no-audit --no-fund && npm run check && npm run build",
			];
	}
}

/**
 * Deterministic suite selection for a change. Exported for its colocated
 * test; the mapping is the whole policy — no LLM judgment involved.
 */
export function deriveVerificationSuites(
	filesChanged: string[],
): SuitePlan[] {
	const plans: SuitePlan[] = [];
	if (filesChanged.some((path) => path.startsWith("extensions/"))) {
		plans.push({
			name: "extensions",
			command: buildSuiteCommand("extensions", null),
		});
	}
	if (filesChanged.some((path) => path.startsWith("docs-site/"))) {
		plans.push({
			name: "docs-site",
			command: buildSuiteCommand("docs-site", null),
		});
	}
	const appPaths = filesChanged.filter(isAppRelevantPath);
	if (appPaths.length > 0) {
		plans.push({ name: "check", command: buildSuiteCommand("check", null) });
		plans.push({ name: "test", command: buildSuiteCommand("test", null) });
		// The structural scripts (render seam, discoverability, name
		// dispositions, planning state) guard invariants vitest cannot see;
		// they run on every app change so a drift on main is caught at
		// integration, not weeks later.
		plans.push({
			name: "structural",
			command: buildSuiteCommand("structural", null),
		});
	}
	return plans;
}

/**
 * The `<title>` of a served app shell, for the post-integration smoke.
 * Exported for its colocated test.
 */
export function extractHtmlTitle(html: string): string | null {
	return /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
}

/**
 * The `gfx-release` meta of a served app shell — the release identity a
 * browser can read back after a deploy or rollback (ADR-0052). Exported for
 * its colocated test.
 */
export function extractServedReleaseMeta(html: string): string | null {
	return /<meta\s+name="gfx-release"\s+content="([^"]*)"/.exec(html)?.[1] || null;
}

type MethodContext = {
	repoDir: string;
	logger: { info: (msg: string, props?: Record<string, unknown>) => void };
	writeResource: (
		specName: string,
		name: string,
		data: Record<string, unknown>,
	) => Promise<{ name: string }>;
	createFileWriter: (
		specName: string,
		name: string,
	) => { writeText: (text: string) => Promise<{ name: string }> };
};

/** Model definition for the GFX deterministic verification runner. */
export const model = {
	type: "@gfx/verify",
	version: "2026.09.01.3",
	globalArguments: GlobalArgsSchema,
	resources: {
		verification: {
			description:
				"Per-suite check outcome for one labelled verification run (instances: verification-<label>)",
			schema: VerificationSchema,
			lifetime: "infinite",
			garbageCollection: 25,
		},
		serving: {
			description:
				"Post-integration rebuild + live-serve smoke outcome for one supervised project (instances: serving-<projectName>)",
			schema: ServingSmokeSchema,
			lifetime: "infinite",
			garbageCollection: 25,
		},
	},
	files: {
		log: {
			description: "Tail of each failing suite's output for the labelled run",
			contentType: "text/plain",
			lifetime: "1mo",
			garbageCollection: 10,
		},
	},
	methods: {
		run_checks: {
			description:
				"Run change-scoped repo suites in a worktree (explicit `suites` overrides; else derived from `filesChanged`); succeeds only when all pass",
			arguments: RunChecksArgumentsSchema,
			execute: async (
				args: z.infer<typeof RunChecksArgumentsSchema>,
				context: MethodContext,
			) => {
				const packageJsonPath = `${args.worktreePath}/package.json`;
				try {
					await Deno.stat(packageJsonPath);
				} catch {
					throw new TypeError(
						`worktreePath is not a checkout root (no package.json): ${args.worktreePath}`,
					);
				}

				let selection: "explicit" | "derived" | "fallback";
				let plans: SuitePlan[];
				if (args.suites) {
					selection = "explicit";
					plans = args.suites.map((name) => ({
						name,
						command: buildSuiteCommand(name, null),
					}));
				} else if (args.filesChanged) {
					selection = "derived";
					plans = deriveVerificationSuites(args.filesChanged);
				} else {
					selection = "fallback";
					plans = [
						{ name: "check", command: buildSuiteCommand("check", null) },
						{ name: "test", command: buildSuiteCommand("test", null) },
					];
				}
				context.logger.info(
					"verify {label}: {selection} selection → {suites}",
					{
						label: args.label,
						selection,
						suites: plans.map((plan) => plan.name).join(",") || "(none)",
					},
				);

				const suiteOutcomes: z.infer<typeof SuiteOutcomeSchema>[] = [];
				const failureTails: string[] = [];
				for (const plan of plans) {
					const startedAt = Date.now();
					const command = new Deno.Command(plan.command[0], {
						args: plan.command.slice(1),
						cwd: args.worktreePath,
						stdout: "piped",
						stderr: "piped",
					});
					const { code, stdout, stderr } = await command.output();
					const durationMs = Date.now() - startedAt;
					suiteOutcomes.push({
						name: plan.name,
						exitCode: code,
						passed: code === 0,
						durationMs,
					});
					context.logger.info("verify suite {suite}: exit {code} in {ms}ms", {
						suite: plan.name,
						code,
						ms: durationMs,
					});
					if (code !== 0) {
						const combined = `${new TextDecoder().decode(stdout)}\n${new TextDecoder().decode(stderr)}`;
						failureTails.push(
							`=== ${plan.name} (exit ${code}) ===\n${combined.slice(-4000)}`,
						);
					}
				}

				const failedSuites = suiteOutcomes
					.filter((outcome) => !outcome.passed)
					.map((outcome) => outcome.name);
				const verification = {
					ranAt: new Date().toISOString(),
					worktreePath: args.worktreePath,
					label: args.label,
					selection,
					suites: suiteOutcomes,
					failedSuites,
					passed: failedSuites.length === 0,
				};

				const dataHandles = [
					await context.writeResource(
						"verification",
						`verification-${args.label}`,
						verification,
					),
				];
				if (failureTails.length > 0) {
					const logWriter = context.createFileWriter("log", `log-${args.label}`);
					dataHandles.push(await logWriter.writeText(failureTails.join("\n\n")));
				}

				if (failedSuites.length > 0) {
					throw new Error(
						`verification failed for ${args.label}: ${failedSuites.join(", ")} (details in verification-${args.label})`,
					);
				}
				return { dataHandles };
			},
		},
		rebuild_and_smoke: {
			description:
				"Rebuild the primary checkout's production artifact, restart its supervised local-dev project, and smoke the live origin (status, health, gfx-release meta) against the landed commit",
			arguments: RebuildAndSmokeArgumentsSchema,
			execute: async (
				args: z.infer<typeof RebuildAndSmokeArgumentsSchema>,
				context: MethodContext,
			) => {
				try {
					await Deno.stat(`${args.repoPath}/package.json`);
				} catch {
					throw new TypeError(
						`repoPath is not a checkout root (no package.json): ${args.repoPath}`,
					);
				}

				const smoke: z.infer<typeof ServingSmokeSchema> = {
					ranAt: new Date().toISOString(),
					repoPath: args.repoPath,
					projectName: args.projectName,
					originUrl: args.originUrl,
					landedSha: "",
					buildMs: 0,
					restarted: false,
					httpStatus: null,
					healthStatus: null,
					title: null,
					servedRelease: null,
					passed: false,
					failure: null,
				};
				const failureTails: string[] = [];

				const runStep = async (
					label: string,
					command: string[],
				): Promise<{ code: number; stdout: string; stderr: string }> => {
					const startedAt = Date.now();
					const { code, stdout, stderr } = await new Deno.Command(command[0], {
						args: command.slice(1),
						cwd: args.repoPath,
						stdout: "piped",
						stderr: "piped",
					}).output();
					context.logger.info("serve smoke {step}: exit {code} in {ms}ms", {
						step: label,
						code,
						ms: Date.now() - startedAt,
					});
					const decoded = {
						code,
						stdout: new TextDecoder().decode(stdout),
						stderr: new TextDecoder().decode(stderr),
					};
					if (code !== 0) {
						failureTails.push(
							`=== ${label} (exit ${code}) ===\n${decoded.stdout.slice(-2000)}\n${decoded.stderr.slice(-2000)}`,
						);
					}
					return decoded;
				};

				const record = async (failure: string | null) => {
					smoke.failure = failure;
					smoke.passed = failure === null;
					const dataHandles = [
						await context.writeResource(
							"serving",
							`serving-${args.projectName}`,
							smoke,
						),
					];
					if (failureTails.length > 0) {
						const logWriter = context.createFileWriter(
							"log",
							`log-serving-${args.projectName}`,
						);
						dataHandles.push(
							await logWriter.writeText(failureTails.join("\n\n")),
						);
					}
					if (failure !== null) {
						throw new Error(
							`serve smoke failed for ${args.projectName}: ${failure} (details in serving-${args.projectName})`,
						);
					}
					return { dataHandles };
				};

				const revParse = await runStep("rev-parse", [
					"git",
					"rev-parse",
					"HEAD",
				]);
				if (revParse.code !== 0) return record("git rev-parse HEAD failed");
				smoke.landedSha = revParse.stdout.trim();

				const buildStartedAt = Date.now();
				const build = await runStep("build", ["pnpm", "run", "build"]);
				smoke.buildMs = Date.now() - buildStartedAt;
				if (build.code !== 0) return record("pnpm build failed");

				// local-dev-control's restart contract fails when the project's port
				// does not become reachable again, so a zero exit means the new
				// artifact is what answers the port.
				const restart = await runStep("restart", [
					"swamp-local",
					"model",
					"method",
					"run",
					"local-dev-control",
					"restart",
					"--input",
					`name=${args.projectName}`,
				]);
				if (restart.code !== 0) return record("supervised restart failed");
				smoke.restarted = true;

				let shellHtml: string | null = null;
				for (let attempt = 0; attempt < 5 && shellHtml === null; attempt++) {
					if (attempt > 0) {
						await new Promise((settle) => setTimeout(settle, 2000));
					}
					try {
						const response = await fetch(args.originUrl, {
							signal: AbortSignal.timeout(15_000),
						});
						smoke.httpStatus = response.status;
						const body = await response.text();
						if (response.status === 200) shellHtml = body;
					} catch {
						smoke.httpStatus = null;
					}
				}
				if (shellHtml === null) {
					return record(
						`the origin did not answer 200 (last status: ${smoke.httpStatus})`,
					);
				}

				// Recorded, not asserted: the app renders client-side, so the served
				// shell legitimately carries no <title> until the browser runs it.
				smoke.title = extractHtmlTitle(shellHtml);
				smoke.servedRelease = extractServedReleaseMeta(shellHtml);
				try {
					const health = await fetch(`${args.originUrl}/api/health`, {
						signal: AbortSignal.timeout(15_000),
					});
					smoke.healthStatus = health.status;
					await health.body?.cancel();
				} catch {
					smoke.healthStatus = null;
				}

				// Another lane may integrate between this run's build and this fetch,
				// and a development-profile host computes the meta per request from
				// its checkout — so compare against HEAD as of the fetch, not the
				// build. The build-time commit stays recorded in landedSha.
				const headNow = await runStep("rev-parse-at-fetch", [
					"git",
					"rev-parse",
					"HEAD",
				]);
				const expectedSha = headNow.code === 0
					? headNow.stdout.trim()
					: smoke.landedSha;
				const expectedReleases = new Set([
					`gfx@${smoke.landedSha}`,
					`gfx@${expectedSha}`,
				]);
				if (
					smoke.servedRelease === null ||
					!expectedReleases.has(smoke.servedRelease)
				) {
					return record(
						`served gfx-release is ${smoke.servedRelease ?? "absent"}, expected ${[...expectedReleases].join(" or ")}`,
					);
				}
				// A 503 here is the readiness contract's designed low-scratch-disk
				// answer (ADR-0052) and does not gate serving; only an unreachable
				// or malformed health surface fails the smoke.
				if (smoke.healthStatus !== 200 && smoke.healthStatus !== 503) {
					return record(
						`/api/health answered ${smoke.healthStatus ?? "nothing"}, expected 200 or 503`,
					);
				}
				return record(null);
			},
		},
	},
};
