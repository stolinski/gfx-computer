import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
	new URL('../src/lib/platform/Workspace.svelte', import.meta.url),
	'utf8'
);
const renderer = readFileSync(
	new URL('../src/lib/platform/composition-frame-renderer.ts', import.meta.url),
	'utf8'
);
const exportController = readFileSync(
	new URL('../src/lib/platform/composition-export-controller.ts', import.meta.url),
	'utf8'
);
const sceneStepper = readFileSync(
	new URL('../src/lib/platform/film-scene-frame-stepper.ts', import.meta.url),
	'utf8'
);
const exportFrame = source.match(
	/async function performExport\([\s\S]*?renderCompositionFrame: \(outputView, timestamp\) =>\s*([^\n]+)/
);

assert.ok(exportFrame, 'Workspace must provide the controller a live export frame callback');
assert.match(
	exportFrame[1],
	/renderCompositionFrameTo\(buildCompositionFrameRenderRequest\(outputView, timestamp\)\)/,
	'export must delegate its supplied Scene target to the shared render seam'
);
assert.doesNotMatch(
	exportFrame[1],
	/renderDepthStage|renderDofPlanes|pipeline\.render|effectChain\.apply|shaderPassDispatcher\.apply/,
	'export must not carry a second render dispatch'
);
assert.match(
	exportController,
	/createFilmSceneFrameStepper\(\{[\s\S]*?renderCompositionFrame: dependencies\.renderCompositionFrame,/,
	'the export controller must pass the live frame callback to the Film Scene stepper'
);
assert.match(
	sceneStepper,
	/dependencies\.renderCompositionFrame\(request\.readOutputView\(\), timestamp\)/,
	"the Film Scene stepper must invoke Workspace's shared frame callback with the current target"
);
assert.equal(
	(renderer.match(/export function renderCompositionFrameTo\(/g) ?? []).length,
	1,
	'the focused renderer module must own exactly one composition frame seam'
);
// Two upload sites, both inside the seam's Surface capture: the ungated lane
// for a frame without a capture record, and the paint-record-gated lane
// (commit 6d57f18 — an element the browser has never painted has nothing to
// copy). Neither the Workspace nor the export controller may grow a third.
assert.equal(
	(renderer.match(/pipeline\.uploadDom\(\)/g) ?? []).length,
	2,
	'the shared frame seam must own the only live DOM upload operations'
);
assert.match(
	renderer,
	/function captureSurfaceDom\([\s\S]*?pipeline\.uploadDom\(\);[\s\S]*?hasCapturedPaintRecord\(capture\.surface\)[\s\S]*?uploadDomIfPainted\(\(\) => pipeline\.uploadDom\(\)\)[\s\S]*?\n\}/,
	'both Surface DOM uploads must live in captureSurfaceDom, the second behind the paint-record gate and the painted-upload guard'
);
assert.doesNotMatch(
	source,
	/uploadDom\(/,
	'Workspace must not upload DOM outside the shared frame seam'
);
assert.doesNotMatch(
	exportController,
	/uploadDom\(/,
	'the export controller must not upload DOM outside the shared frame seam'
);
assert.match(
	renderer,
	/uploadedSurfaceGenerations\.get\(pipeline\) !== capture\.surface/,
	'preview DOM uploads must be gated by browser paint generations'
);
assert.match(
	source,
	/force: isExporting/,
	'export frames must force the post-settlement DOM capture'
);
assert.match(
	source,
	/if \(next\.isExporting\) heldFilmBoundaryFrame = null;/,
	'export must discard held preview boundary frames before rendering its own'
);
assert.match(
	source,
	/async function performExport\([\s\S]*?\): Promise<CompositionExportOutcome> \{\s*await tick\(\);[\s\S]*?readFilm: \(\) => cloneJsonValue\(readOpenFilm\(\)\)/,
	'export must flush reactive effects and plan from a detached Film snapshot'
);
assert.match(
	source,
	/compositionExportHandle\.current = \(\{ request, signal \}\) =>\s*performExport\(request, signal\);/,
	'the delivery family must export through the same Workspace runner the Export button uses'
);
assert.match(
	source,
	/compositionVerificationProbe\.current = \{[\s\S]*?captureSettledFrame:[\s\S]*?settleDeterministicCompositionFrame\(/,
	'the verification family must measure frames through the shared deterministic settle'
);
assert.match(
	sceneStepper,
	/async function prepareScene\([\s\S]*?await dependencies\.waitForCompositionResources\(signal\)[\s\S]*?await prepareScene\([\s\S]*?await dependencies\.settleCompositionPaint\(signal\)[\s\S]*?await dependencies\.prepareCompositionFrame/,
	'the Film Scene stepper must await resources and browser paint settlement before frame preparation'
);
assert.equal(
	(renderer.match(/request\.buildSurfaceInputs\(request\.timestamp\)/g) ?? []).length,
	1,
	'the shared frame seam must build complete Surface inputs once'
);
assert.match(
	renderer,
	/const builtInputs = request\.buildSurfaceInputs\(request\.timestamp\);[\s\S]*?readableProbeMode === 'readable-mask'[\s\S]*?\{ \.\.\.builtInputs, chart: undefined \}/,
	'readable-mask capture must derive from the single complete Surface input build'
);
assert.doesNotMatch(
	source,
	/function renderDepthStage\(|function renderDofPlanes\(|effectChain\.apply\(|shaderPassDispatcher\.apply\(/,
	'Workspace must not retain composition-frame branch dispatch'
);

console.log('test-workspace-render-seam.ts: all assertions passed');
