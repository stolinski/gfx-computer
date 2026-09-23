import { readFileSync, existsSync } from 'node:fs';
import { resolve, posix } from 'node:path';

import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import anchor from 'markdown-it-anchor';
import Shiki from '@shikijs/markdown-it';
import type { BundledLanguage } from 'shiki';
import packShowcase from '../pack-showcase.json';
import { getPacksPage } from './packs';

// shiki accepts the special 'txt' language at runtime; the plugin's option type doesn't admit it
const PLAINTEXT = 'txt' as unknown as BundledLanguage;

const DOCS_DIR = resolve(process.cwd(), '..', 'docs');

/** docs/aesthetic.md is a redirect stub — every link to it should land on the real doc. */
const LINK_ALIASES: Record<string, string> = {
	'aesthetic.md': 'packs/syntax/aesthetic.md'
};

interface PublishedDoc {
	file: string;
	title: string;
	section: string;
}

interface PublishedPage {
	href: string;
	title: string;
	section: string;
}

type PublishedEntry = PublishedDoc | PublishedPage;

function isPublishedDoc(entry: PublishedEntry): entry is PublishedDoc {
	return 'file' in entry;
}

/**
 * The published set, in reading order. docs.gfx.computer is for someone using
 * GFX — running it, authoring a Preset, picking a Pack; the apex is the app
 * itself. The repo's other docs exist to
 * build the software: ADRs, Briefs, the roadmap, the rubrics, the Critic
 * protocol, the identity spec, `ideas/`, and the engine blueprint with its file
 * layout and internals are development surfaces and have no URL here — links to
 * them de-link at render time. Publishing a page means adding a row; there is no
 * directory walk that could publish one by accident.
 */
const PUBLISHED: readonly PublishedEntry[] = [
	{ file: 'README.md', title: 'Overview', section: 'Start' },
	{ file: 'getting-started.md', title: 'Getting started', section: 'Start' },
	{ file: 'CONTEXT.md', title: 'Glossary', section: 'Start' },
	// Interim: the format reference stands in until the authoring guides land.
	{ file: 'preset-format.md', title: 'Preset format', section: 'Authoring' },
	{ href: '/packs', title: 'Packs', section: 'Packs' }
];

const PUBLISHED_DOCS = PUBLISHED.filter(isPublishedDoc);
const PUBLISHED_FILES = new Set(PUBLISHED_DOCS.map((doc) => doc.file));

export interface DocMeta {
	file?: string;
	href: string;
	title: string;
	section: string;
}

export interface NavSection {
	label: string;
	items: DocMeta[];
}

export interface DocHeading {
	depth: number;
	id: string;
	text: string;
}

export interface DocPage {
	meta: DocMeta & { file: string };
	html: string;
	headings: DocHeading[];
	prev: DocMeta | null;
	next: DocMeta | null;
}

export interface SearchEntry {
	title: string;
	href: string;
	section: string;
	text: string;
}

function fileToHref(file: string): string {
	if (file === 'README.md') return '/overview';
	if (file.endsWith('/README.md')) return '/' + posix.dirname(file);
	return '/' + file.replace(/\.md$/, '');
}

function toMeta(entry: PublishedEntry): DocMeta {
	return isPublishedDoc(entry)
		? { file: entry.file, href: fileToHref(entry.file), title: entry.title, section: entry.section }
		: entry;
}

/** Sections come from the allowlist's own order — consecutive rows sharing a label. */
function buildNav(): NavSection[] {
	const sections: NavSection[] = [];
	for (const doc of PUBLISHED) {
		const open = sections.at(-1);
		if (open?.label === doc.section) open.items.push(toMeta(doc));
		else sections.push({ label: doc.section, items: [toMeta(doc)] });
	}
	return sections;
}

/**
 * Where a docs link lands. The repo is private, so a link either resolves to a
 * page this site publishes or it carries no anchor at all — never a
 * github.com fallback. (Link rot is the third case, and it throws.)
 */
type DocLinkResolution = { kind: 'page'; href: string } | { kind: 'delink' };

/**
 * Resolves one markdown link against the published doc set. Three outcomes, and
 * the private repo is never one of them: a target on the allowlist becomes a
 * site link; a target that exists in the repo but is not published — an ADR, a
 * Brief, the schema JSON, anything above `docs/` — renders as plain text; and a
 * target that exists nowhere is link rot, which throws and fails the build (this
 * runs only during prerender, so the throw always surfaces there).
 */
function resolveDocLink(href: string, currentFile: string): DocLinkResolution {
	if (/^(https?:|mailto:|#)/.test(href)) return { kind: 'page', href };
	const [path, hash] = href.split('#');
	const suffix = hash ? '#' + hash : '';
	const dir = posix.dirname(currentFile);
	let target = posix.normalize(posix.join(dir === '.' ? '' : dir, path));
	// escapes docs/ — ../src/…, ../AGENTS.md — so no page exists to link to
	if (target.startsWith('..')) return { kind: 'delink' };
	target = LINK_ALIASES[target] ?? target;
	// Keep repository links useful without publishing Pack-authoring doctrine.
	const pack = /^packs\/([^/]+)\/aesthetic\.md$/.exec(target);
	if (pack && packShowcase.packs.some((entry) => entry.slug === pack[1])) {
		return { kind: 'page', href: `/packs#${pack[1]}` };
	}
	// a directory link stands for that directory's README
	const file = target.endsWith('.md') ? target : posix.join(target, 'README.md');
	if (PUBLISHED_FILES.has(file)) return { kind: 'page', href: fileToHref(file) + suffix };
	if (existsSync(resolve(DOCS_DIR, target))) return { kind: 'delink' };
	throw new Error(
		`docs link rot: docs/${currentFile} links to "${href}", but docs/${target} does not exist. ` +
			`Point it at a live doc or de-link it — the private repo is never a fallback.`
	);
}

/**
 * `link_close` tokens whose `link_open` de-linked, mapped to the markup that
 * closes what the open rule emitted. markdown-it never nests links, so a
 * link_open's match is simply the next link_close.
 */
const DELINKED_LINK_CLOSE = new WeakMap<Token, string>();

function findLinkCloseIndex(tokens: Token[], idx: number): number {
	for (let i = idx + 1; i < tokens.length; i += 1) {
		if (tokens[i].type === 'link_close') return i;
	}
	return -1;
}

let enginePromise: Promise<MarkdownIt> | null = null;

function getEngine(): Promise<MarkdownIt> {
	enginePromise ??= (async () => {
		// linkify stays off: bare file names like CLAUDE.md would autolink (.md is a TLD)
		const md = new MarkdownIt({ html: true });
		md.use(
			await Shiki({
				theme: 'poimandres',
				fallbackLanguage: PLAINTEXT,
				defaultLanguage: PLAINTEXT
			})
		);
		md.use(anchor, {
			// GitHub's slug algorithm — docs hand-author cross-links like `#q15-…--never-pop`,
			// so each removed punctuation run must leave its double hyphen behind
			slugify: (s: string) =>
				s
					.toLowerCase()
					.trim()
					.replace(/[^\w\s-]/g, '')
					.replace(/\s/g, '-'),
			permalink: anchor.permalink.linkInsideHeader({
				symbol: '#',
				class: 'h-anchor',
				placement: 'after'
			})
		});

		md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
		md.renderer.rules.table_close = () => '</table></div>';

		const defaultLinkOpen =
			md.renderer.rules.link_open ??
			((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
		const defaultLinkClose =
			md.renderer.rules.link_close ??
			((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
		md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
			const token = tokens[idx];
			const href = token.attrGet('href');
			if (href) {
				const resolution = resolveDocLink(href, env.file as string);
				if (resolution.kind === 'delink') {
					// the link text stands in for the anchor as inline code; text that is
					// already `code` keeps its own tags rather than nesting a second pair
					const closeIdx = findLinkCloseIndex(tokens, idx);
					const wrap = !(closeIdx === idx + 2 && tokens[idx + 1].type === 'code_inline');
					if (closeIdx >= 0) DELINKED_LINK_CLOSE.set(tokens[closeIdx], wrap ? '</code>' : '');
					return wrap ? '<code>' : '';
				}
				token.attrSet('href', resolution.href);
				if (/^https?:/.test(resolution.href)) {
					token.attrSet('target', '_blank');
					token.attrSet('rel', 'noopener');
				}
			}
			return defaultLinkOpen(tokens, idx, options, env, self);
		};
		md.renderer.rules.link_close = (tokens, idx, options, env, self) => {
			const delinked = DELINKED_LINK_CLOSE.get(tokens[idx]);
			if (delinked !== undefined) return delinked;
			return defaultLinkClose(tokens, idx, options, env, self);
		};

		const defaultImage =
			md.renderer.rules.image ??
			((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
		md.renderer.rules.image = (tokens, idx, options, env, self) => {
			const token = tokens[idx];
			const src = token.attrGet('src');
			if (src) {
				const resolution = resolveDocLink(src, env.file as string);
				// captures live in the repo but this site publishes no docs assets, so an
				// unresolvable image leaves its caption behind rather than a broken <img>
				if (resolution.kind === 'delink') {
					return md.utils.escapeHtml(self.renderInlineAsText(token.children ?? [], options, env));
				}
				token.attrSet('src', resolution.href);
			}
			return defaultImage(tokens, idx, options, env, self);
		};
		return md;
	})();
	return enginePromise;
}

function extractHeadings(html: string): DocHeading[] {
	const headings: DocHeading[] = [];
	for (const match of html.matchAll(/<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
		const text = match[3]
			.replace(/<a[^>]*class="h-anchor"[\s\S]*?<\/a>/g, '')
			.replace(/<[^>]+>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.trim();
		headings.push({ depth: Number(match[1]), id: match[2], text });
	}
	return headings;
}

export function getNav(): NavSection[] {
	return buildNav();
}

export function getAllHrefs(): string[] {
	return PUBLISHED_DOCS.map((doc) => fileToHref(doc.file));
}

export async function getDoc(slug: string): Promise<DocPage | null> {
	const href = '/' + slug;
	const index = PUBLISHED.findIndex((entry) => toMeta(entry).href === href);
	const entry = PUBLISHED[index];
	if (!entry || !isPublishedDoc(entry)) return null;

	const meta = { ...toMeta(entry), file: entry.file };
	const md = await getEngine();
	const src = readFileSync(resolve(DOCS_DIR, meta.file), 'utf-8');
	const html = md.render(src, { file: meta.file });

	return {
		meta,
		html,
		headings: extractHeadings(html),
		prev: index > 0 ? toMeta(PUBLISHED[index - 1]) : null,
		next: index < PUBLISHED.length - 1 ? toMeta(PUBLISHED[index + 1]) : null
	};
}

export function getSearchIndex(): SearchEntry[] {
	return PUBLISHED.map((entry) => {
		const item = toMeta(entry);
		if (!isPublishedDoc(entry)) {
			return {
				title: item.title,
				href: item.href,
				section: item.section,
				text: getPacksPage()
					.dresses.map((pack) =>
						[pack.label, pack.feel, ...pack.faces.map((face) => face.family)].join(' ')
					)
					.join(' ')
			};
		}
		const src = readFileSync(resolve(DOCS_DIR, entry.file), 'utf-8');
		const text = src
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/^#.*$/m, ' ')
			.replace(/[#>*`_[\]|]/g, ' ')
			.replace(/\(([^)]*)\)/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 4000);
		return { title: item.title, href: item.href, section: item.section, text };
	});
}
