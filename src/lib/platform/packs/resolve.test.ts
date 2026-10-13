import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { PACK_REGISTRY } from './registry.ts';
import {
	requireCoreColor,
	resolveAppearanceVars,
	resolveBackgroundFill,
	resolveFieldInkColor,
	resolvePackRoleColor,
	FIGURE_TEXT_FILL_CONTRAST,
	resolveFigureVoiceColors
} from './resolve.ts';
import type { PackManifest } from './types.ts';
import { cssWcagContrastRatio } from '$lib/utils/color';

describe('resolveBackgroundFill (ADR-0039 §3)', () => {
	it('passes an absent fill through — presence stays the transparent/opaque signal', () => {
		assert.equal(resolveBackgroundFill(PACK_REGISTRY.syntax, undefined), undefined);
	});

	it('passes an authored hex through untouched — an explicit colour wins over the Pack', () => {
		assert.equal(resolveBackgroundFill(PACK_REGISTRY.syntax, '#123456'), '#123456');
	});

	it("resolves the 'pack' sentinel to every registered Pack's field-treatment core", () => {
		for (const [slug, manifest] of Object.entries(PACK_REGISTRY)) {
			assert.equal(
				resolveBackgroundFill(manifest, 'pack'),
				requireCoreColor(manifest, 'field-treatment'),
				`pack "${slug}"`
			);
		}
	});

	it('locks the calibrated field values the corpus conversion depends on', () => {
		// The 2026-08-03 corpus fold rewrote presets restating these exact hexes
		// to the sentinel — resolution must reproduce them byte-for-byte or the
		// converted presets change pixels under their own pack.
		assert.equal(resolveBackgroundFill(PACK_REGISTRY.syntax, 'pack'), '#0e0e0d');
		assert.equal(resolveBackgroundFill(PACK_REGISTRY['clean-light'], 'pack'), '#f6f7f8');
	});

	it('fails fast when a manifest is missing the mandatory field-treatment core', () => {
		const corrupted: PackManifest = {
			slug: 'corrupted',
			label: 'Corrupted',
			description: 'A manifest the boot validator would refuse.',
			roles: {}
		};
		assert.throws(() => resolveBackgroundFill(corrupted, 'pack'), /field-treatment/);
	});
});

describe('resolveAppearanceVars closed role contracts', () => {
	it('does not emit an unknown role that borrows a familiar CSS suffix', () => {
		const pack = structuredClone(PACK_REGISTRY.syntax);
		pack.roles['lower-third.leading'] = { kind: 'style', value: '0.8' };
		pack.roles['lower-third.font'] = { kind: 'style', value: 'Invented Sans' };
		const vars = resolveAppearanceVars(pack, 'lower-third');
		assert.equal(vars['--leading'], undefined);
		assert.notEqual(vars['--font'], 'Invented Sans');
	});

	it('emits an exact registered CSS role through its declared variable consumer', () => {
		assert.equal(
			resolveAppearanceVars(PACK_REGISTRY.syntax, 'lower-third')['--border'],
			PACK_REGISTRY.syntax.roles['lower-third.border']?.kind === 'style'
				? PACK_REGISTRY.syntax.roles['lower-third.border'].value
				: undefined
		);
	});

	it('falls from an absent specific colour role to its mandatory core', () => {
		const pack = structuredClone(PACK_REGISTRY.syntax);
		delete pack.roles['lower-third.ink'];
		assert.equal(
			resolveAppearanceVars(pack, 'lower-third')['--ink'],
			requireCoreColor(pack, 'ink-treatment')
		);
	});

	it('uses declared fallbacks for a core-only secondary Pack', () => {
		const pack = structuredClone(PACK_REGISTRY.syntax);
		const mandatory = new Set([
			'fill-treatment',
			'ink-treatment',
			'accent-treatment',
			'field-treatment',
			'edge-treatment',
			'depth-treatment',
			'light-treatment'
		]);
		for (const role of Object.keys(pack.roles)) {
			if (!mandatory.has(role)) delete pack.roles[role];
		}
		assert.equal(resolveAppearanceVars(pack, 'chapter-card')['--base'], '#1a1612');
		assert.equal(resolveAppearanceVars(pack, 'lower-third')['--kickerInk'], '#ffd54a');
		assert.equal(resolveAppearanceVars(pack, 'lower-third')['--plate'], undefined);
		assert.equal(resolveAppearanceVars(pack, 'washi-tape')['--grain-dark'], undefined);
		assert.equal(resolvePackRoleColor(pack, 'tear-out.fill', 'accent-treatment'), '#ffd54a');
	});
});

describe('resolveFieldInkColor', () => {
	it('resolves each registered Pack field/ink pair explicitly', () => {
		assert.equal(resolveFieldInkColor(PACK_REGISTRY.syntax), '#f7f6f2');
		assert.equal(resolveFieldInkColor(PACK_REGISTRY['editorial-mono']), '#eef3f8');
		assert.equal(resolveFieldInkColor(PACK_REGISTRY['crt-terminal']), '#45ff6e');
		assert.equal(resolveFieldInkColor(PACK_REGISTRY['clean-light']), '#16181d');
	});

	it('preserves authored composition ink', () => {
		assert.equal(resolveFieldInkColor(PACK_REGISTRY.syntax, '#123456'), '#123456');
	});

	it('falls back to mandatory ink-treatment when the optional pair is absent', () => {
		const pack = structuredClone(PACK_REGISTRY['clean-light']);
		delete pack.roles['field-ink-treatment'];
		assert.equal(resolveFieldInkColor(pack), '#16181d');
	});
});

describe('resolveFigureVoiceColors', () => {
	it('shades every series fill that carries text until its ink reaches the text-fill contrast', () => {
		for (const pack of Object.values(PACK_REGISTRY)) {
			const voices = resolveFigureVoiceColors(pack);
			for (const voice of ['series-0', 'series-1', 'series-2', 'series-3'] as const) {
				const ratio = cssWcagContrastRatio(voices.readableOn[voice], voices.textFill[voice]);
				assert.ok(ratio >= FIGURE_TEXT_FILL_CONTRAST, `${pack.slug} ${voice}: ${ratio.toFixed(2)}`);
			}
		}
	});
});
