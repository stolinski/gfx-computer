import { SvelteMap, SvelteSet } from 'svelte/reactivity';

import type { AnimationTweenSpec } from '$lib/platform/animation-manager';
import type { TextAnimation, Transport } from '$lib/platform/engine-schema';

import { TEXT_EFFECT_CATALOG, type TextEffectSpec, type TextEffectSplitMode } from './catalog';
import { compileTextAnimation } from './compile';
import { splitTextAnimationElement, type TextAnimationSplitResult } from './split-text';
import {
	resolveTextAnimationVariableWeightTreatment,
	stabilizeTextAnimationVariableWeightLayout
} from './unit-style';
import type { TextAnimationResolvedUnit } from './unit-types';

const DATA_SLOT_ATTRIBUTE = 'data-text-anim-slot';

/**
 * Stable key derived from an entry's target. Used as the lookup index for
 * `unitAlphaAt` and for matching DOM nodes back to entries.
 */
export function textAnimationSlotKeyFor(entry: TextAnimation): string {
	if (entry.target.kind === 'surface') {
		return `surface:${entry.target.slot}`;
	}
	return `overlay:${entry.target.overlayId}:${entry.target.slot}`;
}

/**
 * DOM-selector form of `textAnimationSlotKeyFor`. Overlay slots are scoped under their
 * overlay container via `data-overlay-id`; surface slots live directly under
 * the surface CanvasSource root.
 */
function findSlotElement(root: HTMLElement, entry: TextAnimation): HTMLElement | null {
	if (entry.target.kind === 'surface') {
		return root.querySelector<HTMLElement>(`[${DATA_SLOT_ATTRIBUTE}="${entry.target.slot}"]`);
	}

	const scope = root.querySelector<HTMLElement>(`[data-overlay-id="${entry.target.overlayId}"]`);
	const within = scope ?? root;
	return within.querySelector<HTMLElement>(`[${DATA_SLOT_ATTRIBUTE}="${entry.target.slot}"]`);
}

interface ActiveEntry {
	entry: TextAnimation;
	spec: TextEffectSpec;
	split: TextAnimationSplitResult;
	units: TextAnimationResolvedUnit[];
	tweens: AnimationTweenSpec[];
}

/**
 * Peer to AnimationManager. Owns the lifecycle of every `textAnimations[]`
 * entry: maintains the SplitText state for each slot, compiles the catalog
 * spec into AnimationTweenSpec[], and feeds them into the parent
 * AnimationManager. Also publishes a per-unit alpha map the marks-coupling
 * layer reads via `unitAlphaAt`.
 *
 * The class is intentionally a small JS class, not a Svelte rune-based store,
 * because it owns DOM mutation (SplitText creates spans inline) that should
 * not be triggered by reactivity.
 */
export class TextAnimationManager {
	#active = new SvelteMap<string, ActiveEntry>();
	#unitAlpha = new SvelteMap<string, Float32Array>();

	/**
	 * Rebuild the active set from the current preset. Returns the union of
	 * tweens to hand to AnimationManager.
	 *
	 * Idempotent: if `entries` and `root` and `transport` haven't changed, the
	 * returned tween list is identical. SplitText is re-run only when the
	 * target text content or split mode changes for a given slot.
	 */
	rebuild(
		root: HTMLElement | null,
		entries: readonly TextAnimation[],
		transport: Transport
	): AnimationTweenSpec[] {
		if (!root) {
			this.#disposeAll();
			return [];
		}

		const nextKeys = new SvelteSet<string>();
		const out: AnimationTweenSpec[] = [];

		for (const entry of entries) {
			const key = textAnimationSlotKeyFor(entry);
			nextKeys.add(key);

			const spec = TEXT_EFFECT_CATALOG.get(entry.effect);
			if (!spec) {
				continue;
			}

			const element = findSlotElement(root, entry);
			if (!element) {
				continue;
			}

			const existing = this.#active.get(key);
			const splitMode = spec.target satisfies TextEffectSplitMode;

			// Re-split when Svelte replaced the slot element (a `{#key}` on the
			// slot's content forces this on every authored edit — without it,
			// SplitText would orphan Svelte's text node and updates would stop
			// rendering), the split mode changed, or the textContent itself
			// drifted.
			const needsResplit =
				!existing ||
				existing.split.root !== element ||
				existing.split.mode !== splitMode ||
				existing.split.signature !== element.textContent;

			let split: TextAnimationSplitResult;
			if (needsResplit) {
				existing?.split.revert();
				split = splitTextAnimationElement(element, splitMode);
			} else {
				split = existing.split;
			}

			const units: TextAnimationResolvedUnit[] = split.units.map((el, index) => ({
				index,
				element: el,
				text: el.textContent ?? '',
				variableWeightTreatment: resolveTextAnimationVariableWeightTreatment(el)
			}));
			for (const unit of units) {
				stabilizeTextAnimationVariableWeightLayout(
					unit.element,
					unit.variableWeightTreatment,
					spec.requiresVariableWeight
						? {
								normalizedWeight: spec.enter.to.font_weight_normalized ?? 0.5,
								...(spec.enter.to.letter_spacing_em === undefined
									? {}
									: { letterSpacingEm: spec.enter.to.letter_spacing_em })
							}
						: null
				);
			}

			// Allocate / resize the per-unit alpha buffer.
			let alphaBuf = this.#unitAlpha.get(key);
			if (!alphaBuf || alphaBuf.length !== units.length) {
				alphaBuf = new Float32Array(units.length);
				this.#unitAlpha.set(key, alphaBuf);
			}

			const writeUnitAlpha = (unitIndex: number, alpha: number): void => {
				if (alphaBuf && unitIndex >= 0 && unitIndex < alphaBuf.length) {
					alphaBuf[unitIndex] = alpha;
				}
			};

			const compiled = compileTextAnimation({
				entry,
				spec,
				units,
				transport,
				writeUnitAlpha
			});

			this.#active.set(key, { entry, spec, split, units, tweens: compiled.tweens });
			out.push(...compiled.tweens);
		}

		// Tear down any keys that disappeared from the new entry list.
		for (const key of [...this.#active.keys()]) {
			if (nextKeys.has(key)) {
				continue;
			}
			this.#active.get(key)?.split.revert();
			this.#active.delete(key);
			this.#unitAlpha.delete(key);
		}

		return out;
	}

	/**
	 * Per-unit alpha lookup the marks renderer uses. Whole-element animations
	 * return the single shared alpha for every index; per-word / per-line
	 * effects return the unit alpha at that index.
	 *
	 * Out-of-range or unknown slot returns 1 (no attenuation) so the marks
	 * renderer doesn't accidentally zero them out for slots that have no
	 * textAnimations entry.
	 */
	unitAlphaAt(slotKey: string, unitIndex: number): number {
		const buf = this.#unitAlpha.get(slotKey);
		if (!buf || buf.length === 0) {
			return 1;
		}
		// For `whole` effects there's exactly one unit; clamp the index.
		const safeIndex = Math.max(0, Math.min(unitIndex, buf.length - 1));
		return buf[safeIndex];
	}

	/**
	 * Returns the unit-index range a given body-character span overlaps. The
	 * marks renderer uses this to take a `min`-over-overlapped-units when a
	 * per-word or per-line entry shares the body slot with marks.
	 */
	unitRangeFor(
		slotKey: string,
		startChar: number,
		endChar: number
	): { from: number; to: number } | null {
		// Walk the units' textContent to find character offsets. Only called
		// from the per-frame loop on bodies that have marks-coupling enabled,
		// so the linear cost is acceptable.
		const entry = [...this.#active.values()].find(
			(a) => textAnimationSlotKeyFor(a.entry) === slotKey
		);
		if (!entry) {
			return null;
		}
		let cursor = 0;
		let from = -1;
		let to = -1;
		for (let i = 0; i < entry.units.length; i += 1) {
			const len = entry.units[i].text.length;
			const unitStart = cursor;
			const unitEnd = cursor + len;
			if (from < 0 && unitEnd > startChar) {
				from = i;
			}
			if (unitStart < endChar) {
				to = i;
			}
			cursor = unitEnd;
		}
		if (from < 0 || to < 0) {
			return null;
		}
		return { from, to };
	}

	dispose(): void {
		this.#disposeAll();
	}

	#disposeAll(): void {
		for (const active of this.#active.values()) {
			active.split.revert();
		}
		this.#active.clear();
		this.#unitAlpha.clear();
	}
}

declare global {
	interface Window {
		__gfxTextAnimationManager?: TextAnimationManager;
	}
}
