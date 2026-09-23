#!/usr/bin/env node
/** Built docs smoke + desktop/mobile captures. Uses a jailed preview and scripted CDP only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
	assertVerificationOriginAllowed,
	createVerificationServerJail
} from './verification-server-jail.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs-site');
const origin = `http://127.0.0.1:${Number(process.env.GFX_DOCS_PROBE_PORT ?? 7314)}`;
assertVerificationOriginAllowed(origin);
assert.notEqual(new URL(origin).port, '4173', 'Do not replace the managed review service');
const output = resolve(root, '.tmp-verification/docs-showcase');
await mkdir(output, { recursive: true });
const catalog = JSON.parse(await readFile(resolve(docs, 'src/lib/pack-showcase.json'), 'utf8'));
const clips = JSON.parse(await readFile(resolve(docs, 'src/lib/preset-loops.json'), 'utf8'));
const hero = JSON.parse(await readFile(resolve(docs, 'src/lib/workspace-loop.json'), 'utf8'));
const jail = await createVerificationServerJail('docs-showcase');
const server = spawn(
	resolve(docs, 'node_modules/.bin/vite'),
	['preview', '--host', '127.0.0.1', '--port', new URL(origin).port, '--strictPort'],
	{
		cwd: docs,
		env: { ...process.env, ...jail.environment },
		stdio: ['ignore', 'ignore', 'inherit']
	}
);
let serverFailure;
server.on('error', (error) => {
	serverFailure = error;
});
let browser;
const results = [];
try {
	let ready = false;
	for (let attempt = 0; attempt < 120; attempt++) {
		if (serverFailure) throw serverFailure;
		if (server.exitCode !== null) throw new Error(`Docs preview exited ${server.exitCode}`);
		try {
			ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
		} catch {}
		if (ready) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.ok(ready, 'Docs preview is ready');
	browser = await chromium.connectOverCDP(
		`http://127.0.0.1:${Number(process.env.CDP_PORT ?? 9223)}`
	);
	for (const width of [1440, 390]) {
		const context = await browser.newContext({
			viewport: { width, height: 1000 },
			reducedMotion: 'reduce'
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		for (const route of ['/', '/overview', '/packs', '/getting-started']) {
			const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
			assert.equal(response?.status(), 200, route);
			await page.evaluate(() => document.fonts.ready);
			const layout = await page.evaluate(() => ({
				viewport: innerWidth,
				width: document.documentElement.scrollWidth,
				overflowing: [...document.querySelectorAll('main *')]
					.filter(
						(el) =>
							el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('pre, .table-wrap')
					)
					.map((el) => ({
						tag: el.tagName,
						text: el.textContent?.slice(0, 100),
						right: el.getBoundingClientRect().right
					}))
					.slice(0, 8)
			}));
			assert.ok(
				layout.width <= width + 1,
				`No horizontal overflow at ${width}: ${route}: ${JSON.stringify(layout)}`
			);
			assert.equal(
				await page.locator('a[href*="github.com/stolinski"]').count(),
				0,
				'No private-repository links'
			);
			if (route === '/') {
				assert.equal(
					await page.locator('video.app source').getAttribute('src'),
					hero.video,
					'Preserve the shipped Workspace hero'
				);
			}
			if (route === '/' || route === '/overview') {
				assert.equal(await page.locator('.preset-loops video').count(), clips.length);
				await page.locator('.preset-loops video').first().scrollIntoViewIfNeeded();
				assert.ok(
					await page
						.locator('.preset-loops video')
						.evaluateAll((videos) =>
							videos.every((video) => video.paused && !video.hasAttribute('src'))
						),
					'Reduced motion: posters only, clips not fetched'
				);
				await page.screenshot({
					path: resolve(output, `${width}-${route === '/' ? 'home' : 'overview'}-loops.png`),
					fullPage: false
				});
				await page.evaluate(() => window.scrollTo(0, 0));
			}
			if (route === '/packs') {
				assert.deepEqual(
					await page.locator('main h2').evaluateAll((headings) => headings.map((h) => h.id)),
					catalog.packs.map((pack) => pack.slug)
				);
				for (const pack of catalog.packs) {
					const section = page
						.locator('main section')
						.filter({ has: page.locator(`h2#${pack.slug}`) });
					await section.scrollIntoViewIfNeeded();
					await section.locator('img').evaluate((image) => image.decode());
					assert.equal(await section.locator('img').evaluate((image) => image.naturalWidth), 1600);
					assert.equal(await section.locator('.swatches li').count(), pack.swatches.length);
					for (const swatch of pack.swatches)
						assert.ok((await section.textContent()).includes(swatch.hex));
				}
				await page.locator('#sentry').scrollIntoViewIfNeeded();
				await page.screenshot({ path: resolve(output, `${width}-sentry.png`) });
				await page.evaluate(() => window.scrollTo(0, 0));
			}
			await page.screenshot({
				path: resolve(output, `${width}-${route === '/' ? 'home' : route.slice(1)}.png`),
				fullPage: true
			});
			results.push({ width, route, status: 'pass' });
		}
		await page.goto(origin + '/overview', { waitUntil: 'networkidle' });
		assert.equal(
			await page.locator('a[href="/packs#sentry"]').count(),
			1,
			'Overview links Sentry to the visual showcase'
		);
		await page.locator('a[href="/packs#sentry"]').click();
		await page.waitForURL('**/packs#sentry');
		assert.ok(await page.locator('#sentry').isVisible());
		assert.deepEqual(errors, [], 'No browser runtime errors');
		await context.close();
	}
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		reducedMotion: 'no-preference'
	});
	const page = await context.newPage();
	await page.goto(origin, { waitUntil: 'networkidle' });
	const first = page.locator('.preset-loops video').first();
	await first.scrollIntoViewIfNeeded();
	await page.waitForFunction(() => {
		const video = document.querySelector('.preset-loops video');
		return video instanceof HTMLVideoElement && !video.paused && video.currentTime > 0;
	});
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.waitForFunction(() =>
		[...document.querySelectorAll('.preset-loops video')].every((video) => video.paused)
	);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.waitForFunction(() => !document.querySelector('.preset-loops video').paused);
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.waitForFunction(() => document.querySelector('.preset-loops video').paused);
	for (const clip of clips) {
		for (const extension of ['mp4', 'webp']) {
			const response = await context.request.get(`${origin}/renders/${clip.stem}.${extension}`);
			assert.equal(response.status(), 200, `${clip.stem}.${extension}`);
		}
	}
	for (const pack of catalog.packs) {
		const retired = await context.request.get(`${origin}/packs/${pack.slug}/aesthetic`);
		assert.equal(retired.status(), 404, 'Internal Pack doctrine is not published');
	}
	await context.close();
	results.push({
		check: 'visible playback, offscreen pause, live reduced-motion changes, assets, retired pages',
		status: 'pass'
	});
	await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
	console.log(JSON.stringify({ status: 'pass', output, checks: results }, null, 2));
} finally {
	if (browser) await browser.close();
	if (server.exitCode === null) {
		const closed = new Promise((resolve) => server.once('close', resolve));
		server.kill('SIGTERM');
		const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
		await closed;
		clearTimeout(timer);
	}
	await jail.dispose();
}
