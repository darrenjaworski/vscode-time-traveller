/**
 * `Evidence` is the structured bundle the chat orchestrator hands to the
 * prompt builder. Keeping it free of `vscode` imports means both the
 * aggregation and the prompt generation can be unit-tested without a VS Code
 * runtime. The orchestrator shells out via `src/git/cli.ts`, then feeds the
 * raw records to `composeEvidence`.
 */
import type { BlameLine, CommitFileChange, RawLogRecord } from '../git/cli';

export interface CommitSummary {
	sha: string;
	shortSha: string;
	subject: string;
	body: string;
	authorName: string;
	authorEmail: string;
	authorDate: Date;
	isMerge: boolean;
}

export interface EvidenceSelection {
	relPath: string;
	startLine: number; // 1-based, inclusive
	endLine: number; // 1-based, inclusive
	excerpt: string;
}

export interface Evidence {
	/** Workspace-relative path of the file the question is about. Always set
	 * when the handler resolves a file, even when no selection is present —
	 * gives the prompt builder a fallback scope line ("File: …") for
	 * commit-focused queries where we intentionally drop the selection. */
	relPath?: string;
	selection?: EvidenceSelection;
	blameLines?: BlameLine[];
	/** Commits that directly touch this file, newest → oldest. */
	fileCommits: CommitSummary[];
	/** Commits explicitly referenced by the user's prompt (e.g. from the
	 * history panel's "Ask @historian about this commit" action). Shown first
	 * in the prompt so the model focuses on them. */
	referencedCommits: CommitSummary[];
	/** Filter targets surfaced to the user — e.g. the ref for `/since` or
	 * the author pattern for `/author`. Non-semantic, just a hint for the
	 * prompt header. */
	filterDescription?: string;
	/** Per-commit file stats (from `git show --numstat`), keyed by full SHA.
	 * Populated for commit-focused queries — lets the prompt ground a "story
	 * of a commit" in what the commit actually touched. */
	commitFiles?: Map<string, CommitFileChange[]>;
	/** Trimmed patch text per commit (from `git show --patch`), keyed by full
	 * SHA. Scoped to `relPath` when the query has a file context. Already
	 * capped for prompt size — see `trimPatch`. */
	commitDiffs?: Map<string, string>;
}

export function recordToSummary(record: RawLogRecord): CommitSummary {
	const parents = record.parents ? record.parents.split(' ').filter(Boolean) : [];
	return {
		sha: record.sha,
		shortSha: record.shortSha,
		subject: record.subject,
		body: record.body,
		authorName: record.authorName,
		authorEmail: record.authorEmail,
		authorDate: new Date(record.authorDate),
		isMerge: parents.length > 1,
	};
}

/**
 * Extracts the first short or full SHA from a free-form prompt. Used so the
 * history panel's `askBlame` command (which prompts with "why did commit
 * abc1234 change …") produces commit-focused evidence without extra plumbing.
 */
export function extractShaMention(prompt: string): string | undefined {
	const match = prompt.match(/\b([0-9a-f]{7,40})\b/i);
	return match ? match[1] : undefined;
}

export interface EvidenceInputs {
	relPath?: string;
	selection?: EvidenceSelection;
	blameLines?: BlameLine[];
	fileRecords: RawLogRecord[];
	referencedShas?: string[];
	filterDescription?: string;
	commitFiles?: Map<string, CommitFileChange[]>;
	commitDiffs?: Map<string, string>;
}

export function composeEvidence(inputs: EvidenceInputs): Evidence {
	const fileCommits = inputs.fileRecords.map(recordToSummary);
	const referencedCommits: CommitSummary[] = [];
	const referenced = new Set(inputs.referencedShas?.map((s) => s.toLowerCase()) ?? []);
	if (referenced.size > 0) {
		for (const c of fileCommits) {
			if (
				referenced.has(c.sha.toLowerCase()) ||
				referenced.has(c.shortSha.toLowerCase()) ||
				[...referenced].some((r) => c.sha.toLowerCase().startsWith(r))
			) {
				referencedCommits.push(c);
			}
		}
	}
	return {
		relPath: inputs.relPath,
		selection: inputs.selection,
		blameLines: inputs.blameLines,
		fileCommits,
		referencedCommits,
		filterDescription: inputs.filterDescription,
		commitFiles: inputs.commitFiles,
		commitDiffs: inputs.commitDiffs,
	};
}

/**
 * Unique SHAs the prompt will cite, in a stable order (referenced first, then
 * the order they appear in the file's log). Used by the orchestrator to emit
 * `ChatResponseReference`s so each cited commit becomes a clickable chip.
 */
export function citedShas(evidence: Evidence, maxCount = 10): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const push = (sha: string) => {
		if (seen.has(sha) || out.length >= maxCount) return;
		seen.add(sha);
		out.push(sha);
	};
	for (const c of evidence.referencedCommits) push(c.sha);
	if (evidence.blameLines) {
		for (const line of evidence.blameLines) push(line.sha);
	}
	for (const c of evidence.fileCommits) push(c.sha);
	return out;
}
