import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import { iconOrbitHistoryAt, iconOrbitTarget, resolveIconOrbitFlight } from './icon-orbit-flight';

const settings = { centerX: 0.5, radius: 0.3, turnDegreesPerSecond: 8, tilt: 0 };
const plan = { launchSeconds: 1, launchX: 0.3, angleDegrees: -60, height: 0.3, seed: 0.42 };

describe('resolveIconOrbitFlight', () => {
	it('waits below the frame until launch', () => {
		const frame = resolveIconOrbitFlight(plan, settings, 0.5);
		assert.equal(frame.isLaunched, false);
		assert.ok(frame.y > 1);
	});

	it('floats up without shooting past its place, then settles onto the orbit', () => {
		let highest = 1;
		for (let time = 1; time < 9; time += 1 / 30) {
			highest = Math.min(highest, resolveIconOrbitFlight(plan, settings, time).y);
		}
		assert.ok(highest > plan.height - 0.03, 'it never overshoots far');
		const settled = resolveIconOrbitFlight(plan, settings, 9);
		const target = iconOrbitTarget(plan, settings, 8, 0);
		assert.ok(Math.abs(settled.x - target.x) < 0.03);
		assert.ok(Math.abs(settled.y - plan.height) < 0.03);
		assert.ok(settled.speed < 0.1);
	});

	it('is the same at the same time however it is reached', () => {
		const first = resolveIconOrbitFlight(plan, settings, 2.5);
		resolveIconOrbitFlight(plan, settings, 4);
		assert.deepEqual(resolveIconOrbitFlight(plan, settings, 2.5), first);
	});

	it('turns the ring as one, so icons launched apart keep their spacing', () => {
		const early = { ...plan, launchSeconds: 0.5, angleDegrees: -40, seed: 0.1 };
		const late = { ...plan, launchSeconds: 4.5, angleDegrees: 0, seed: 0.2 };
		const ringAngle = (flight: { x: number; nearness: number }): number =>
			(Math.atan2((flight.x - settings.centerX) / settings.radius, flight.nearness) * 180) /
			Math.PI;
		const gapAt = (time: number): number =>
			ringAngle(resolveIconOrbitFlight(late, settings, time)) -
			ringAngle(resolveIconOrbitFlight(early, settings, time));
		assert.ok(Math.abs(gapAt(8) - 40) < 3);
		assert.ok(Math.abs(gapAt(11) - 40) < 3);
	});

	it('circles the subject, so a front icon passes behind it', () => {
		const slow = { ...settings, turnDegreesPerSecond: 30 };
		const front = { ...plan, angleDegrees: -60 };
		assert.ok(resolveIconOrbitFlight(front, slow, 3).nearness > 0.5);
		assert.ok(resolveIconOrbitFlight(front, slow, 8).nearness < 0);
	});

	it('keeps its full path for the dust it sheds', () => {
		const frame = resolveIconOrbitFlight(plan, settings, 2);
		assert.ok(iconOrbitHistoryAt(frame.history, 0.5));
		assert.equal(iconOrbitHistoryAt(frame.history, 5), null);
	});
});
