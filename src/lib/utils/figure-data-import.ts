import { FigureSchema, type Figure, type FigureKind } from '$lib/platform/engine-schema';

/**
 * CSV / JSON import for Figure data (ADR-0067 §7). The parsed values are copied
 * inline into the composition; nothing is fetched or linked. JSON is the kind's
 * own `data` object. CSV follows one plain convention per kind:
 *
 * - `bar-race` — first column the frame label (year), one column per entity.
 * - `line` — first column x, one column per series.
 * - `slope` — first column the entity, one column per period.
 * - `sankey`, `network` — `source,target[,value]` rows; nodes come from the names.
 * - `tree`, `treemap` — `name,parent[,value]` rows; the root has an empty parent.
 * - `cycle` — `step[,detail]` rows.
 * - `neural-network` — JSON only (a layer stack is not tabular).
 *
 * A header row is required. Ids are slugged from names; labels keep the names.
 */
export type FigureDataImportFormat = 'csv' | 'json';

export type FigureDataImportResult =
	{ ok: true; data: Figure['data'] } | { ok: false; message: string };

/** Splits CSV text into rows of trimmed cells, honouring double-quoted cells. */
export function parseFigureCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (quoted) {
			if (character === '"' && text[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				cell += character;
			}
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === ',') {
			row.push(cell.trim());
			cell = '';
		} else if (character === '\n' || character === '\r') {
			if (character === '\r' && text[index + 1] === '\n') index += 1;
			row.push(cell.trim());
			if (row.some((value) => value.length > 0)) rows.push(row);
			row = [];
			cell = '';
		} else cell += character;
	}
	row.push(cell.trim());
	if (row.some((value) => value.length > 0)) rows.push(row);
	return rows;
}

/** A Figure data id from a display name: lowercase letters, digits, and dashes. */
export function slugFigureDataId(name: string, taken: Set<string>): string {
	const base =
		name
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'item';
	let id = base;
	for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
	taken.add(id);
	return id;
}

function parseNumberCell(value: string, where: string): number {
	const cleaned = value.replace(/[,\s$€£%]/g, '');
	const number = Number(cleaned);
	if (cleaned.length === 0 || !Number.isFinite(number)) {
		throw new RangeError(`Figure import: ${where} — "${value}" is not a number.`);
	}
	return number;
}

function requireColumns(rows: string[][], minimum: number, shape: string): void {
	if (rows.length < 2)
		throw new RangeError(`CSV needs a header row and at least one data row (${shape}).`);
	if (rows[0].length < minimum)
		throw new RangeError(`CSV needs at least ${minimum} columns (${shape}).`);
}

function namedNodes(names: readonly string[]): {
	ids: Map<string, string>;
	nodes: { id: string; label: string }[];
} {
	const taken = new Set<string>();
	const ids = new Map<string, string>();
	const nodes: { id: string; label: string }[] = [];
	for (const name of names) {
		if (ids.has(name)) continue;
		const id = slugFigureDataId(name, taken);
		ids.set(name, id);
		nodes.push({ id, label: name });
	}
	return { ids, nodes };
}

function csvToFigureData(kind: FigureKind, rows: string[][], current: Figure): Figure['data'] {
	const [header, ...body] = rows;
	switch (kind) {
		case 'bar-race': {
			requireColumns(rows, 3, 'frame,entity…');
			const { ids, nodes } = namedNodes(header.slice(1));
			const format = current.kind === 'bar-race' ? current.data.valueFormat : { precision: 0 };
			return {
				entities: nodes,
				frames: body.map((row, rowIndex) => ({
					label: row[0],
					values: header.slice(1).flatMap((name, column) => {
						const cell = row[column + 1] ?? '';
						return cell.length === 0
							? []
							: [
									{
										entityId: ids.get(name) ?? '',
										value: parseNumberCell(cell, `row ${rowIndex + 2}`)
									}
								];
					})
				})),
				valueFormat: format
			};
		}
		case 'line': {
			requireColumns(rows, 2, 'x,series…');
			const taken = new Set<string>();
			const base = current.kind === 'line' ? current.data : null;
			return {
				series: header.slice(1).map((name, column) => ({
					id: slugFigureDataId(name, taken),
					label: name,
					points: body.flatMap((row, rowIndex) => {
						const cell = row[column + 1] ?? '';
						return cell.length === 0
							? []
							: [
									{
										x: parseNumberCell(row[0], `row ${rowIndex + 2}`),
										y: parseNumberCell(cell, `row ${rowIndex + 2}`)
									}
								];
					})
				})),
				xFormat: base?.xFormat ?? 'number',
				yFormat: base?.yFormat ?? { precision: 0 },
				...(base?.yAxisLabel ? { yAxisLabel: base.yAxisLabel } : {})
			};
		}
		case 'slope': {
			requireColumns(rows, 3, 'entity,period…');
			const periodTaken = new Set<string>();
			const { nodes } = namedNodes(body.map((row) => row[0]));
			return {
				periods: header
					.slice(1)
					.map((label) => ({ id: slugFigureDataId(`p-${label}`, periodTaken), label })),
				entities: body.map((row, rowIndex) => ({
					...nodes[rowIndex],
					values: header
						.slice(1)
						.map((_, column) => parseNumberCell(row[column + 1] ?? '', `row ${rowIndex + 2}`))
				})),
				valueFormat: current.kind === 'slope' ? current.data.valueFormat : { precision: 0 }
			};
		}
		case 'sankey':
		case 'network': {
			requireColumns(rows, 2, 'source,target[,value]');
			const { ids, nodes } = namedNodes(body.flatMap((row) => [row[0], row[1]]));
			const links = body.map((row, rowIndex) => ({
				source: ids.get(row[0]) ?? '',
				target: ids.get(row[1]) ?? '',
				...(row[2] !== undefined && row[2].length > 0
					? { value: parseNumberCell(row[2], `row ${rowIndex + 2}`) }
					: {})
			}));
			if (kind === 'sankey') {
				return {
					nodes,
					links: links.map((link, index) => {
						if (!('value' in link))
							throw new RangeError(`row ${index + 2}: a Sankey link needs a value.`);
						return link as { source: string; target: string; value: number };
					}),
					valueFormat: current.kind === 'sankey' ? current.data.valueFormat : { precision: 0 }
				};
			}
			return { nodes, links };
		}
		case 'tree':
		case 'treemap': {
			requireColumns(rows, 2, 'name,parent[,value]');
			const { ids } = namedNodes(body.map((row) => row[0]));
			const nodes = body.map((row, rowIndex) => {
				const parentName = row[1] ?? '';
				if (parentName.length > 0 && !ids.has(parentName)) {
					throw new RangeError(
						`row ${rowIndex + 2}: parent "${parentName}" is not a name in the first column.`
					);
				}
				return {
					id: ids.get(row[0]) ?? '',
					label: row[0],
					...(parentName.length > 0 ? { parent: ids.get(parentName) } : {}),
					...(kind === 'treemap' && row[2] !== undefined && row[2].length > 0
						? { value: parseNumberCell(row[2], `row ${rowIndex + 2}`) }
						: {})
				};
			});
			return kind === 'treemap'
				? {
						nodes,
						valueFormat: current.kind === 'treemap' ? current.data.valueFormat : { precision: 0 }
					}
				: { nodes };
		}
		case 'cycle': {
			requireColumns(rows, 1, 'step[,detail]');
			const { nodes } = namedNodes(body.map((row) => row[0]));
			return {
				steps: nodes.map((node, index) => ({
					...node,
					...(body[index][1] ? { detail: body[index][1] } : {})
				}))
			};
		}
		case 'neural-network':
			throw new RangeError('A neural network imports from JSON only: its layers are not a table.');
	}
}

/**
 * Parses imported text into the target Figure's `data` shape, narrowed through
 * that kind's data schema. The edit transaction still refuses it whole when it
 * breaks a reference, a hierarchy, or a Pin.
 */
export function parseFigureDataImport(
	figure: Figure,
	format: FigureDataImportFormat,
	text: string
): FigureDataImportResult {
	const schema = FigureSchema.options.find((option) => option.shape.kind.value === figure.kind)
		?.shape.data;
	if (!schema) return { ok: false, message: `No data shape is registered for ${figure.kind}.` };
	let candidate: unknown;
	try {
		candidate =
			format === 'json'
				? JSON.parse(text)
				: csvToFigureData(figure.kind, parseFigureCsv(text), figure);
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : 'The data could not be read.'
		};
	}
	const parsed = schema.safeParse(candidate);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return {
			ok: false,
			message: `Imported data does not fit a ${figure.kind}: ${issue.path.join('.') || 'data'} — ${issue.message}`
		};
	}
	return { ok: true, data: parsed.data };
}
