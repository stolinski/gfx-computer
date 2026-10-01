export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Deterministic JSON: object keys sorted recursively so a hash is order-stable. */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/**
 * Order-stable content hash of any JSON-serializable value (cyrb53 over a
 * deterministic stringify). Returns a 16-char hex string — used as a content
 * key so a cache entry self-invalidates when its source changes.
 */
export function hashObject(value: unknown): string {
	const str = stableStringify(value);
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
	return hex(h2) + hex(h1);
}

/**
 * A copy of `source` with each dotted path (`pixelSize`, `region.x`) set to its
 * number. Only the objects along a written path are copied; everything else is
 * shared. A path whose parent is absent or not a plain object is skipped
 * rather than invented, because a half-built nested object (a `melt` with only
 * a `radius`) is not a value its reader expects.
 */
export function withDottedPathNumbers(
	source: Readonly<Record<string, unknown>>,
	values: Readonly<Record<string, number>>
): Record<string, unknown> {
	const root: Record<string, unknown> = { ...source };
	for (const [path, value] of Object.entries(values)) {
		const keys = path.split('.');
		let parent: Record<string, unknown> | null = root;
		for (let index = 0; parent && index < keys.length - 1; index += 1) {
			const child: unknown = parent[keys[index]];
			if (!isRecord(child) || Array.isArray(child)) {
				parent = null;
				break;
			}
			const copy: Record<string, unknown> = { ...child };
			parent[keys[index]] = copy;
			parent = copy;
		}
		if (parent) parent[keys[keys.length - 1]] = value;
	}
	return root;
}

/** The value at a dotted path (`region.x`), or undefined when any step is missing. */
export function readDottedPathValue(source: unknown, path: string): unknown {
	let current: unknown = source;
	for (const key of path.split('.')) {
		if (!isRecord(current) || Array.isArray(current)) return undefined;
		current = current[key];
	}
	return current;
}

/**
 * `value` with every field it lacks filled from `defaults`, recursively through
 * plain objects. Fields `value` sets win; arrays and other values are taken as
 * they are. Used to give a nested write its parent objects without inventing
 * fields the defaults do not declare.
 */
export function fillMissingRecordFields(defaults: unknown, value: unknown): unknown {
	if (value === undefined) return defaults;
	if (!isRecord(defaults) || Array.isArray(defaults) || !isRecord(value) || Array.isArray(value)) {
		return value;
	}
	const filled: Record<string, unknown> = { ...value };
	for (const [key, fallback] of Object.entries(defaults)) {
		filled[key] = fillMissingRecordFields(fallback, value[key]);
	}
	return filled;
}
