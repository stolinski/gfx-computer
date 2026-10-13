import assert from 'node:assert/strict';

import { describe, it } from 'vite-plus/test';

import { parseAnnotationBodyText } from '$lib/annotations/annotation-body-text';

import { getSurfaceDefinition } from './pipelines/definition-registry';
import { listSurfaceMarkInstances } from './surface-mark-instances';
import type { SurfaceState } from './engine-schema';

function surfaceWith(type: string, title: string, body: string): SurfaceState {
	const definition = getSurfaceDefinition(type);
	assert.ok(definition, `Surface "${type}" is registered`);
	const defaults = definition.defaults();
	return {
		...defaults,
		content: { ...defaults.content, title, body: parseAnnotationBodyText(body) }
	};
}

describe('listSurfaceMarkInstances', () => {
	it('enumerates headline marks before body marks on a Surface that renders them', () => {
		const surface = surfaceWith(
			'newspaper',
			'Why Bun [highlight]Quietly Replaced[/highlight] npm',
			'A lede with an [underline]underlined run[/underline] in it.'
		);

		const marks = listSurfaceMarkInstances(surface).map((mark) => [
			mark.slot ?? 'body',
			mark.style,
			mark.text,
			mark.startChar,
			mark.endChar
		]);

		assert.deepEqual(marks, [
			['title', 'highlight', 'Quietly Replaced', 8, 24],
			['body', 'underline', 'underlined run', 15, 29]
		]);
	});

	it('ignores headline syntax on a Surface that prints its title plain', () => {
		const surface = surfaceWith(
			'paper',
			'A [highlight]marked[/highlight] title',
			'Body with a [highlight]mark[/highlight].'
		);

		const marks = listSurfaceMarkInstances(surface);

		assert.equal(marks.length, 1);
		assert.equal(marks[0].slot, undefined);
		assert.equal(marks[0].text, 'mark');
	});
});
