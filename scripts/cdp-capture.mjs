// Real-canvas capture over CDP — drives a flag-enabled Chrome (launched with
// --enable-blink-features=CanvasDrawElement) on a debug port, seeks the GFX
// timeline via window.__gfxTimeline.seekProgress, and saves clipped canvas
// screenshots. This is the documented workaround for the chrome-devtools MCP
// browser lacking the html-in-canvas flag. Node 22+ (built-in fetch/WebSocket).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9223);
// The COMPOSITION canvas is the largest-backing one. Never bare
// `querySelector('canvas')`: the editor chrome renders small canvases too
// (timeline sound-clip waveforms), and the capture prep below re-parents the
// composition canvas to <body>, so first-in-document-order is not stable.
const COMPOSITION_CANVAS = `[...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]`;
const SLUG = process.argv[2] ?? 'lower-third';
const PAGE_URL = process.env.CDP_URL ?? `http://localhost:7263/p/${SLUG}`;
const EXPECTED_PATHNAME = new URL(PAGE_URL).pathname;
const OUTDIR = process.env.CDP_OUTDIR ?? `.tmp-baselines/${SLUG}`;
const SAMPLES = (process.env.CDP_SAMPLES ?? '0,0.25,0.5,0.75,1').split(',').map(Number);
const TARGET_ORIENTATION = process.env.CDP_ORIENTATION;
const TARGET_PACK = process.env.CDP_PACK;
const WAIT_SELECTOR = process.env.CDP_WAIT_SELECTOR;
// Decimal places in each frame's file name; a dense sweep (a whole clip) needs more than 2.
const NAME_DIGITS = Number(process.env.CDP_NAME_DIGITS ?? 2);
const BUILT_IN_PRESET_PATH = `src/lib/presets/${SLUG}.json`;
// A stored Film shows its own name, never its slug, so read it from the store.
async function readStoredFilmName() {
	const response = await fetch(`${new URL(PAGE_URL).origin}/api/user-compositions/${SLUG}`);
	const film = response.ok ? await response.json() : null;
	return typeof film?.name === 'string' ? film.name : SLUG;
}
const EXPECTED_PRESET_LABEL = existsSync(BUILT_IN_PRESET_PATH)
	? JSON.parse(readFileSync(BUILT_IN_PRESET_PATH, 'utf8')).name
	: await readStoredFilmName();

mkdirSync(OUTDIR, { recursive: true });

async function getTarget() {
	let reachable = false;
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(`http://localhost:${PORT}/json`);
			const targets = await res.json();
			reachable = true;
			const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
			if (page) return page;
			// Chrome is up but has NO page target (its last tab crashed or was
			// closed — observed after long capture sessions). Self-heal by opening
			// one; newer Chrome requires PUT for /json/new.
			await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: 'PUT' });
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(
		reachable
			? `Chrome on port ${PORT} has no attachable page target (and /json/new could not create one)`
			: `Chrome not reachable on port ${PORT}`
	);
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	ws.onopen = res;
	ws.onerror = rej;
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		if (msg.error) reject(new Error(JSON.stringify(msg.error)));
		else resolve(msg.result);
	}
};
function send(method, params = {}) {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
}
async function evaluate(expression) {
	const r = await send('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true
	});
	if (r.exceptionDetails) {
		throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
	}
	return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
	width: 1280,
	height: 1000,
	deviceScaleFactor: 1,
	mobile: false
});
await send('Page.navigate', { url: PAGE_URL });
await sleep(1800);

let ready = false;
let flag = false;
for (let i = 0; i < 60; i++) {
	try {
		const s = await evaluate(`(() => ({
			canvas: !!(${COMPOSITION_CANVAS}),
			timeline: !!(window.__gfxTimeline),
			body: !!document.body,
			complete: document.readyState === 'complete',
			pathname: location.pathname,
			flag: (typeof GPUQueue !== 'undefined') && ('copyElementImageToTexture' in GPUQueue.prototype)
		}))()`);
		flag = s.flag;
		if (s.canvas && s.timeline && s.body && s.complete && s.pathname === EXPECTED_PATHNAME) {
			ready = true;
			break;
		}
	} catch {}
	await sleep(500);
}
console.log(`READY=${ready}  FLAG(copyElementImageToTexture in GPUQueue)=${flag}`);
if (!flag) {
	console.error('CanvasDrawElement is unavailable; use the flag-enabled Chrome on CDP port 9223.');
	process.exit(1);
}
if (!ready) {
	console.log('App did not become ready; aborting.');
	process.exit(1);
}

// The route can become DOM-ready one tick before its Preset state is applied.
// Wait for the route slug to be reflected in the workspace heading before
// mutating transport/Pack controls, or a late apply can overwrite the choice.
let presetApplied = false;
for (let i = 0; i < 60; i++) {
	presetApplied = await evaluate(
		`document.body.textContent?.includes(${JSON.stringify(EXPECTED_PRESET_LABEL)})`
	);
	if (presetApplied) break;
	await sleep(100);
}
if (!presetApplied) {
	// Continuing here photographs whatever page the tab was on before — a
	// wrong-preset capture that reads as real evidence. Abort instead.
	console.error(`Preset "${SLUG}" never applied to the workspace; aborting.`);
	process.exit(1);
}
await sleep(300);
if (WAIT_SELECTOR) {
	for (let i = 0; i < 60; i++) {
		if (await evaluate(`!!document.querySelector(${JSON.stringify(WAIT_SELECTOR)})`)) break;
		await sleep(100);
	}
}

if (TARGET_ORIENTATION === 'vertical' || TARGET_ORIENTATION === 'horizontal') {
	const label = TARGET_ORIENTATION === 'vertical' ? 'Switch to vertical' : 'Switch to horizontal';
	const expectedWidth = TARGET_ORIENTATION === 'vertical' ? 2160 : 3840;
	const alreadyOriented = await evaluate(`(${COMPOSITION_CANVAS})?.width === ${expectedWidth}`);
	if (!alreadyOriented) {
		const switched = await evaluate(`(() => {
		const button = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)}) ??
			[...document.querySelectorAll('button')].find((candidate) =>
				candidate.textContent?.includes(${JSON.stringify(label)})
			);
		button?.click();
		return !!button;
	})()`);
		if (!switched) throw new Error(`Could not find the ${TARGET_ORIENTATION} transport control`);
		for (let i = 0; i < 30; i++) {
			if (await evaluate(`(${COMPOSITION_CANVAS})?.width === ${expectedWidth}`)) break;
			await sleep(100);
		}
	}
}

if (TARGET_PACK) {
	const switched = await evaluate(`(() => {
		const select = [...document.querySelectorAll('select')].find((candidate) =>
			[...candidate.options].some((option) => option.value === ${JSON.stringify(TARGET_PACK)})
		);
		if (!select) return false;
		select.value = ${JSON.stringify(TARGET_PACK)};
		select.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	})()`);
	if (!switched) throw new Error(`Could not find Pack ${TARGET_PACK}`);
}

await sleep(900);
let capturePrepared = false;
for (let i = 0; i < 60; i++) {
	try {
		capturePrepared = await evaluate(`(() => {
			const c = (${COMPOSITION_CANVAS});
			if (!document.body || !c || !window.__gfxTimeline) return false;
			const captureScale = 4;
			const inheritedStyle = getComputedStyle(c);
			for (const property of ['--frame-w', '--frame-h']) {
				const value = inheritedStyle.getPropertyValue(property);
				if (value) c.style.setProperty(property, value);
			}
			document.body.appendChild(c);
			for (const child of document.body.children) {
				if (child !== c) child.style.visibility = 'hidden';
			}
			// Page.captureScreenshot flattens transparent canvas pixels against the
			// page. Use G5's neutral footage proxy instead of photographing the editor
			// checkerboard and chrome through transparent compositions.
			document.documentElement.style.background = '#7f7f7f';
			document.body.style.background = '#7f7f7f';
			c.style.position = 'fixed';
			c.style.inset = '0 auto auto 0';
			c.style.inlineSize = (c.width / captureScale) + 'px';
			c.style.blockSize = (c.height / captureScale) + 'px';
			c.style.zIndex = '2147483647';
			return true;
		})()`);
		if (capturePrepared) break;
	} catch {}
	await sleep(500);
}
if (!capturePrepared) {
	console.error('Canvas did not remain ready for native-resolution capture.');
	process.exit(1);
}
const rect = await evaluate(`(() => {
	const c = (${COMPOSITION_CANVAS});
	const r = c.getBoundingClientRect();
	const style = getComputedStyle(c);
	return {
		x: r.x,
		y: r.y,
		w: r.width,
		h: r.height,
		clientWidth: c.clientWidth,
		clientHeight: c.clientHeight,
		borderLeft: parseFloat(style.borderLeftWidth),
		borderTop: parseFloat(style.borderTopWidth),
		bw: c.width,
		bh: c.height
	};
})()`);
console.log(
	`canvas displayed=${rect.w}x${rect.h} client=${rect.clientWidth}x${rect.clientHeight} border=${rect.borderLeft}x${rect.borderTop} backing=${rect.bw}x${rect.bh}`
);

const saved = [];
for (const p of SAMPLES) {
	// Seek, then confirm the playhead actually landed before capturing. A bare
	// seekProgress sometimes races the first render after navigate.
	let landedTime = -1;
	for (let i = 0; i < 20; i++) {
		await evaluate(`window.__gfxTimeline.seekProgress(${p})`);
		await sleep(120);
		landedTime = await evaluate(`window.__gfxTimeline.time`);
		const expected = p * (await evaluate(`window.__gfxTimeline.durationSeconds`));
		if (Math.abs(landedTime - expected) < 0.05) break;
	}
	// Settle one more paint at the landed frame.
	await sleep(350);
	// On-surface capture (NO captureBeyondViewport — that re-rasters without the
	// accelerated WebGPU layer and yields a blank canvas). Clip to the canvas.
	// Clip height derives from the BACKING aspect, not the CSS rect — the CSS
	// height × width-scale rounds short (3840×2157 instead of ×2160), which
	// breaks probe-dimensions as an R6 authority.
	const clipScale = rect.w > 0 ? rect.bw / rect.w : 1;
	const shot = await send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.bh / clipScale, scale: clipScale }
	});
	const file = `${OUTDIR}/p${p.toFixed(NAME_DIGITS)}.png`;
	writeFileSync(file, Buffer.from(shot.data, 'base64'));
	saved.push(file);
	console.log(`saved ${file}  (t=${landedTime.toFixed(2)}s)`);
}

ws.close();
console.log(`DONE — ${saved.length} frames`);
process.exit(0);
