/**
 * Pure prompt assembly for the @blame chat participant. Given an evidence
 * bundle and the slash-command variant, produces the `content` strings that
 * the orchestrator wraps into `vscode.LanguageModelChatMessage.User(...)`.
 *
 * Split out so the prompt shape can be tested — and reviewed — without a
 * live model or VS Code runtime.
 */
import type { CommitSummary, Evidence } from './evidence';

export type BlameCommand = 'why' | 'story' | 'blame-since' | 'author' | 'default';

const SYSTEM_PROMPT = [
	'You are @blame, a narrator of git history for the Time Traveller extension.',
	'Your job is to explain *why* code changed, not just who changed it. Ground every claim in the commit messages and diffs you are given; never invent history.',
	'Cite commits inline as `<shortSha>: <subject>` and prefer quoting subject lines verbatim over paraphrasing them.',
	'Keep responses focused and scannable. Use short paragraphs or bullets. If the evidence is thin, say so plainly — it is better than guessing.',
].join('\n');

const COMMIT_CAP = 12;

export function systemPrompt(): string {
	return SYSTEM_PROMPT;
}

export function buildUserPrompt(
	evidence: Evidence,
	command: BlameCommand,
	userPrompt: string,
	now: Date = new Date(),
): string {
	const sections: string[] = [];

	sections.push(taskSection(command, userPrompt));

	if (evidence.selection) {
		sections.push(selectionSection(evidence.selection));
	}

	if (evidence.referencedCommits.length > 0) {
		sections.push(referencedCommitsSection(evidence.referencedCommits, now));
	}

	if (evidence.blameLines && evidence.blameLines.length > 0) {
		sections.push(blameSection(evidence, now));
	}

	if (evidence.fileCommits.length > 0) {
		sections.push(fileLogSection(evidence, command, now));
	}

	if (evidence.filterDescription) {
		sections.push(`Filter: ${evidence.filterDescription}`);
	}

	return sections.join('\n\n');
}

function taskSection(command: BlameCommand, userPrompt: string): string {
	const trimmed = userPrompt.trim();
	const defaultAsk =
		command === 'story'
			? 'Give a narrative timeline of how this file got to its current shape. Highlight turning points and keep it chronological (oldest to newest).'
			: command === 'blame-since'
				? 'Explain what meaningfully changed in this file since the given reference, grouped by theme.'
				: command === 'author'
					? 'Summarize the changes this author has made to this file, with specific examples.'
					: 'Explain why the selected lines are the way they are. Walk through the relevant commits in order and connect them to the code.';
	if (trimmed.length === 0) {
		return `Task: ${defaultAsk}`;
	}
	return `Task: ${defaultAsk}\n\nUser question: ${trimmed}`;
}

function selectionSection(selection: NonNullable<Evidence['selection']>): string {
	return [
		`Selection: ${selection.relPath} (lines ${selection.startLine}–${selection.endLine})`,
		'```',
		selection.excerpt.trimEnd(),
		'```',
	].join('\n');
}

function referencedCommitsSection(commits: CommitSummary[], now: Date): string {
	return [
		'Commits the user explicitly asked about:',
		...commits.map((c) => formatCommitBlock(c, now)),
	].join('\n\n');
}

interface BlameGroup {
	sha: string;
	summary: string;
	author: string;
	timestamp: Date;
	lines: number[];
}

function blameSection(evidence: Evidence, now: Date): string {
	const lines = evidence.blameLines ?? [];
	const byShaRaw = new Map<string, BlameGroup>();
	for (const l of lines) {
		let rec = byShaRaw.get(l.sha);
		if (!rec) {
			rec = {
				sha: l.sha,
				summary: l.summary,
				author: l.author,
				timestamp: new Date(l.authorTime * 1000),
				lines: [],
			};
			byShaRaw.set(l.sha, rec);
		}
		rec.lines.push(l.line);
	}
	const bullets = Array.from(byShaRaw.values()).map(
		(rec) =>
			`- \`${rec.sha.slice(0, 7)}\` · ${rec.author} · ${formatSmartTimestamp(rec.timestamp, now)} — ${rec.summary} — lines ${compressRanges(rec.lines)}`,
	);
	return ['Blame for the selected lines:', ...bullets].join('\n');
}

function fileLogSection(evidence: Evidence, command: BlameCommand, now: Date): string {
	const header =
		command === 'story'
			? 'File history (newest → oldest):'
			: 'Recent file history (newest → oldest):';
	const capped = evidence.fileCommits.slice(0, COMMIT_CAP);
	return [header, ...capped.map((c) => formatCommitBlock(c, now))].join('\n\n');
}

function formatCommitBlock(c: CommitSummary, now: Date): string {
	const mergeTag = c.isMerge ? ' · merge' : '';
	const header = `\`${c.shortSha}\` · ${c.authorName} · ${formatSmartTimestamp(c.authorDate, now)}${mergeTag} — ${c.subject}`;
	if (!c.body) return header;
	const body = c.body
		.split('\n')
		.map((line) => `  ${line}`)
		.join('\n');
	return `${header}\n${body}`;
}

const SHORT_MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

/**
 * Smart timestamp for commit citations. If the commit happened on the same
 * UTC calendar day as `now`, emit just `HH:MM`; otherwise emit `Mon D, YYYY`.
 * Keeps the prompt compact while staying unambiguous across any span of
 * history — a "today" citation reads like an event, an older one reads like
 * a record.
 */
export function formatSmartTimestamp(date: Date, now: Date): string {
	const sameDay =
		date.getUTCFullYear() === now.getUTCFullYear() &&
		date.getUTCMonth() === now.getUTCMonth() &&
		date.getUTCDate() === now.getUTCDate();
	if (sameDay) {
		const h = String(date.getUTCHours()).padStart(2, '0');
		const m = String(date.getUTCMinutes()).padStart(2, '0');
		return `${h}:${m}`;
	}
	return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "1,2,3,5,6,9" → "1-3, 5-6, 9" — keeps the blame summary terse. */
export function compressRanges(numbers: number[]): string {
	if (numbers.length === 0) return '';
	const sorted = [...numbers].sort((a, b) => a - b);
	const ranges: Array<[number, number]> = [];
	let [start, end] = [sorted[0], sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === end + 1) {
			end = sorted[i];
		} else {
			ranges.push([start, end]);
			[start, end] = [sorted[i], sorted[i]];
		}
	}
	ranges.push([start, end]);
	return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}
