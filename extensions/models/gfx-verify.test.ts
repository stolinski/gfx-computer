import { assertEquals, assertRejects } from "jsr:@std/assert@1";

import {
	deriveVerificationSuites,
	extractHtmlTitle,
	extractServedReleaseMeta,
	model,
} from "./gfx-verify.ts";

const runChecks = model.methods.run_checks;
const rebuildAndSmoke = model.methods.rebuild_and_smoke;

function silentContext() {
	return {
		repoDir: "/tmp",
		logger: { info: () => {} },
		writeResource: (_spec: string, name: string) => Promise.resolve({ name }),
		createFileWriter: (_spec: string, name: string) => ({
			writeText: () => Promise.resolve({ name }),
		}),
	};
}

function suiteNames(filesChanged: string[]): string[] {
	return deriveVerificationSuites(filesChanged).map((plan) => plan.name);
}

Deno.test("swamp/meta-only changes derive zero app suites", () => {
	assertEquals(
		suiteNames([
			"models/@swamp/software-factory/gfx-factory.yaml",
			"workflows/workflow-sentry-autofix.yaml",
			".claude/skills/gfx-factory/SKILL.md",
			"docs/roadmap.md",
		]),
		[],
	);
});

Deno.test("extension changes derive only the deno extension suite", () => {
	assertEquals(suiteNames(["extensions/models/gfx-verify.ts"]), ["extensions"]);
});

Deno.test("preset changes keep app checks without automatically invoking authoring verification", () => {
	assertEquals(suiteNames(["src/lib/presets/chapter-card.json"]), ["check", "test", "structural"]);
});

Deno.test("UI changes do not invoke preset verification", () => {
	assertEquals(
		suiteNames(["src/routes/+layout.svelte", "docs/adr/0050-something.md"]),
		["check", "test", "structural"],
	);
});

Deno.test("docs/packs changes retain app checks without inferred preset verification", () => {
	assertEquals(suiteNames(["docs/packs/syntax/aesthetic.md"]), ["check", "test", "structural"]);
});

Deno.test("docs-site changes derive only the docs-site suite", () => {
	assertEquals(
		suiteNames([
			"docs-site/src/lib/server/docs.ts",
			"docs/getting-started.md",
		]),
		["docs-site"],
	);
});

Deno.test("mixed docs-site and app changes derive both lanes", () => {
	assertEquals(
		suiteNames(["docs-site/src/app.css", "src/lib/utils/thing.ts"]),
		["docs-site", "check", "test", "structural"],
	);
});

Deno.test("run_checks arguments accept filesChanged without suites", () => {
	const parsed = runChecks.arguments.parse({
		worktreePath: "/tmp/somewhere",
		label: "task-1",
		filesChanged: ["src/lib/utils/thing.ts"],
	});
	assertEquals(parsed.suites, undefined);
	assertEquals(parsed.filesChanged, ["src/lib/utils/thing.ts"]);
});

Deno.test("run_checks arguments reject a path-unsafe label", () => {
	const result = runChecks.arguments.safeParse({
		worktreePath: "/tmp/somewhere",
		label: "../escape",
	});
	assertEquals(result.success, false);
});

Deno.test("run_checks arguments reject an unknown suite", () => {
	const result = runChecks.arguments.safeParse({
		worktreePath: "/tmp/somewhere",
		label: "task-1",
		suites: ["deploy"],
	});
	assertEquals(result.success, false);
});

Deno.test("run_checks fails fast when worktreePath is not a checkout root", async () => {
	const args = runChecks.arguments.parse({
		worktreePath: "/tmp/definitely-not-a-checkout-root",
		label: "task-1",
	});
	await assertRejects(
		() => runChecks.execute(args, silentContext()),
		TypeError,
		"not a checkout root",
	);
});

Deno.test("extractHtmlTitle reads the app shell title", () => {
	assertEquals(
		extractHtmlTitle("<html><head><title>GFX — chapter-card</title></head>"),
		"GFX — chapter-card",
	);
	assertEquals(extractHtmlTitle("<html><head></head><body></body>"), null);
});

Deno.test("extractServedReleaseMeta reads the gfx-release meta", () => {
	assertEquals(
		extractServedReleaseMeta(
			'<meta name="gfx-release" content="gfx@08c3b6dd6fd6a25d0cc450c0acfe0fed92c3d7f7" />',
		),
		"gfx@08c3b6dd6fd6a25d0cc450c0acfe0fed92c3d7f7",
	);
	// An unsubstituted or empty placeholder is an absent release, not "".
	assertEquals(
		extractServedReleaseMeta('<meta name="gfx-release" content="" />'),
		null,
	);
	assertEquals(extractServedReleaseMeta("<head></head>"), null);
});

Deno.test("rebuild_and_smoke arguments reject a path-unsafe project name", () => {
	const result = rebuildAndSmoke.arguments.safeParse({
		repoPath: "/tmp/somewhere",
		projectName: "../gfx",
		originUrl: "https://gfx.robo.online",
	});
	assertEquals(result.success, false);
});

Deno.test("rebuild_and_smoke fails fast when repoPath is not a checkout root", async () => {
	const args = rebuildAndSmoke.arguments.parse({
		repoPath: "/tmp/definitely-not-a-checkout-root",
		projectName: "gfx",
		originUrl: "https://gfx.robo.online",
	});
	await assertRejects(
		() => rebuildAndSmoke.execute(args, silentContext()),
		TypeError,
		"not a checkout root",
	);
});

Deno.test("serving resource schema accepts a recorded smoke outcome", () => {
	const smoke = model.resources.serving.schema.parse({
		ranAt: new Date().toISOString(),
		repoPath: "/tmp/checkout",
		projectName: "gfx",
		originUrl: "https://gfx.robo.online",
		landedSha: "08c3b6dd6fd6a25d0cc450c0acfe0fed92c3d7f7",
		buildMs: 42_000,
		restarted: true,
		httpStatus: 200,
		healthStatus: 200,
		title: "GFX",
		servedRelease: "gfx@08c3b6dd6fd6a25d0cc450c0acfe0fed92c3d7f7",
		passed: true,
		failure: null,
	});
	assertEquals(smoke.passed, true);
});

Deno.test("verification resource schema accepts a recorded outcome", () => {
	const verification = model.resources.verification.schema.parse({
		ranAt: new Date().toISOString(),
		worktreePath: "/tmp/worktree",
		label: "task-1",
		selection: "derived",
		suites: [{ name: "check", exitCode: 0, passed: true, durationMs: 1200 }],
		failedSuites: [],
		passed: true,
	});
	assertEquals(verification.passed, true);
});
