import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { computeUnifiedBar, resolveUnifiedDrag } from './timeline-clip.ts';

describe('timeline clip', () => {
	it('computes unified bars and resolves drag operations', () => {
		// ── computeUnifiedBar ──────────────────────────────────────────────────────

		{
			// Both ramps → bar spans enter.start → exit end.
			const bar = computeUnifiedBar({ start: 0.2, duration: 0.1 }, { start: 0.8, duration: 0.1 });
			assert.equal(bar.barStart, 0.2);
			assert.ok(Math.abs(bar.barEnd - 0.9) < 1e-9);
			assert.ok(Math.abs(bar.barDuration - 0.7) < 1e-9);
			assert.ok(Math.abs(bar.enterZone - 0.1 / 0.7) < 1e-9);
			assert.ok(Math.abs(bar.exitZone - 0.1 / 0.7) < 1e-9);
		}

		{
			// Enter-only → holds solid to the composition end.
			const bar = computeUnifiedBar({ start: 0.1, duration: 0.2 }, undefined);
			assert.equal(bar.barStart, 0.1);
			assert.equal(bar.barEnd, 1);
			assert.equal(bar.exitZone, 0);
			assert.ok(Math.abs(bar.enterZone - 0.2 / 0.9) < 1e-9);
		}

		{
			// Exit-only → solid from the start.
			const bar = computeUnifiedBar(undefined, { start: 0.7, duration: 0.2 });
			assert.equal(bar.barStart, 0);
			assert.ok(Math.abs(bar.barEnd - 0.9) < 1e-9);
			assert.equal(bar.enterZone, 0);
			assert.ok(Math.abs(bar.exitZone - 0.2 / 0.9) < 1e-9);
		}

		{
			// Ease-aware: a front-loaded enter (lands at 0.5 of its duration) makes the
			// perceived enter ramp half as wide, and the perceived-gone collapses the
			// exit tail. The bar ends where the element is visibly gone, not the schema
			// window end.
			const bar = computeUnifiedBar(
				{ start: 0.2, duration: 0.2 }, // schema enter ends at 0.4; lands at 0.3
				{ start: 0.8, duration: 0.2 }, // schema exit ends at 1.0; gone at 0.9
				0.5,
				0.5
			);
			assert.equal(bar.barStart, 0.2);
			assert.ok(Math.abs(bar.barEnd - 0.9) < 1e-9); // perceived gone, not 1.0
			assert.ok(Math.abs(bar.enterZone - (0.2 * 0.5) / 0.7) < 1e-9); // half-width ramp
			assert.ok(Math.abs(bar.exitZone - (0.2 * 0.5) / 0.7) < 1e-9);
		}

		// ── resolveUnifiedDrag ─────────────────────────────────────────────────────

		const both = { enterStart: 0.2, enterDuration: 0.1, exitStart: 0.8, exitDuration: 0.1 };

		const near = (a: number | undefined, b: number): boolean =>
			a !== undefined && Math.abs(a - b) < 1e-9;

		{
			// move shifts both ramps together, preserving durations.
			const r = resolveUnifiedDrag('move', 0.05, both);
			assert.ok(near(r.enter?.start, 0.25) && near(r.enter?.duration, 0.1), 'move enter');
			assert.ok(near(r.exit?.start, 0.85) && near(r.exit?.duration, 0.1), 'move exit');
		}

		{
			// move is clamped so the exit cannot leave [0,1] (max shift 0.1 here).
			const r = resolveUnifiedDrag('move', 0.5, both);
			assert.ok(near(r.exit?.start, 0.9) && near(r.exit?.duration, 0.1), 'move clamp exit');
			assert.ok(near(r.enter?.start, 0.3), 'move clamp enter');
		}

		{
			// trim-start moves enter.start without touching the exit.
			const r = resolveUnifiedDrag('trim-start', -0.1, both);
			assert.ok(near(r.enter?.start, 0.1) && near(r.enter?.duration, 0.1), 'trim-start');
			assert.equal(r.exit, undefined);
		}

		{
			// enter-zone grows the ramp from a fixed start.
			const r = resolveUnifiedDrag('enter-zone', 0.05, both);
			assert.ok(near(r.enter?.start, 0.2) && near(r.enter?.duration, 0.15), 'enter-zone');
		}

		{
			// exit-zone moves the solid/exit boundary, holding the out-point at 0.9.
			const r = resolveUnifiedDrag('exit-zone', -0.1, both);
			assert.ok(near(r.exit?.start, 0.7) && near(r.exit?.duration, 0.2), 'exit-zone');
		}

		{
			// trim-end moves the out-point, holding exit.start.
			const r = resolveUnifiedDrag('trim-end', 0.05, both);
			assert.ok(near(r.exit?.start, 0.8) && near(r.exit?.duration, 0.15), 'trim-end');
		}

		{
			// Ramp handles the clip does not have are ignored.
			const enterOnly = { enterStart: 0.1, enterDuration: 0.2 };
			assert.deepEqual(resolveUnifiedDrag('exit-zone', 0.1, enterOnly), {});
			assert.deepEqual(resolveUnifiedDrag('trim-end', 0.1, enterOnly), {});

			const exitOnly = { exitStart: 0.7, exitDuration: 0.2 };
			assert.deepEqual(resolveUnifiedDrag('trim-start', 0.1, exitOnly), {});
			assert.deepEqual(resolveUnifiedDrag('enter-zone', 0.1, exitOnly), {});
		}

		{
			// Ease-aware enter-zone: the handle is at the landing (0.2 + 0.2·0.5 = 0.3).
			// Dragging it +0.05 moves the landing to 0.35, and the schema duration grows
			// by delta / landFrac = 0.1 (not 0.05) so the landing actually reaches 0.35.
			const eased = { enterStart: 0.2, enterDuration: 0.2, enterLandFrac: 0.5 };
			const r = resolveUnifiedDrag('enter-zone', 0.05, eased);
			assert.ok(near(r.enter?.start, 0.2), 'eased enter-zone start');
			assert.ok(near(r.enter?.duration, 0.3), 'eased enter-zone duration grows by delta/landFrac');
			// The new landing = start + duration·landFrac = 0.2 + 0.3·0.5 = 0.35.
			assert.ok(
				near((r.enter?.start ?? 0) + (r.enter?.duration ?? 0) * 0.5, 0.35),
				'eased landing lands at handle'
			);
		}
	});
});
