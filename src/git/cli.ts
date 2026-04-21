import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execAsync = promisify(exec);

const MAX_BUFFER = 50 * 1024 * 1024;

export async function showFileAtRef(
	repoRoot: string,
	ref: string,
	relPath: string,
): Promise<string> {
	const spec = `${ref}:${relPath.replace(/\\/g, '/')}`;
	try {
		const { stdout } = await execAsync(`git show ${shellQuote(spec)}`, {
			cwd: repoRoot,
			maxBuffer: MAX_BUFFER,
		});
		return stdout;
	} catch {
		return '';
	}
}

export interface RawLogRecord {
	sha: string;
	shortSha: string;
	authorName: string;
	authorEmail: string;
	authorDate: string;
	parents: string;
	subject: string;
	body: string;
}

export const LOG_FORMAT = '%H%x1F%h%x1F%an%x1F%ae%x1F%aI%x1F%P%x1F%s%x1F%b%x1E';

export async function logFile(
	repoRoot: string,
	relPath: string,
	maxCount: number,
): Promise<RawLogRecord[]> {
	const cmd = `git log --follow --max-count=${maxCount} --pretty=format:${shellQuote(LOG_FORMAT)} -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return parseLog(stdout);
	} catch {
		return [];
	}
}

export async function logRecent(repoRoot: string, maxCount: number): Promise<RawLogRecord[]> {
	const cmd = `git log --max-count=${maxCount} --pretty=format:${shellQuote(LOG_FORMAT)}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return parseLog(stdout);
	} catch {
		return [];
	}
}

/**
 * `git log <since>..HEAD -- <path>` — commits on the current branch that
 * aren't reachable from `sinceRef`. Useful for "what changed since v1.2.0".
 */
export async function logFileSince(
	repoRoot: string,
	relPath: string,
	sinceRef: string,
	maxCount: number,
): Promise<RawLogRecord[]> {
	const cmd = `git log ${shellQuote(sinceRef)}..HEAD --max-count=${maxCount} --follow --pretty=format:${shellQuote(LOG_FORMAT)} -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return parseLog(stdout);
	} catch {
		return [];
	}
}

/**
 * `git log --author=<pattern>` filtered to a single file. The pattern is
 * passed as-is to git, which matches it as a regex against author name+email.
 */
export async function logFileByAuthor(
	repoRoot: string,
	relPath: string,
	authorPattern: string,
	maxCount: number,
): Promise<RawLogRecord[]> {
	const cmd = `git log --follow --max-count=${maxCount} --author=${shellQuote(authorPattern)} --pretty=format:${shellQuote(LOG_FORMAT)} -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return parseLog(stdout);
	} catch {
		return [];
	}
}

export interface BlameLine {
	sha: string;
	line: number;
	author: string;
	authorEmail: string;
	authorTime: number;
	summary: string;
	content: string;
}

/**
 * `git blame --porcelain -L <start>,<end>` and parse the result. `startLine`
 * and `endLine` are 1-based, inclusive, matching git's own convention.
 */
export async function blameRange(
	repoRoot: string,
	relPath: string,
	startLine: number,
	endLine: number,
): Promise<BlameLine[]> {
	const cmd = `git blame --porcelain -L ${startLine},${endLine} -w -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return parseBlamePorcelain(stdout);
	} catch {
		return [];
	}
}

/**
 * Parse git's `--porcelain` blame output. Each line in the range produces a
 * record; commit-level metadata (author, summary, time) is emitted in the
 * first block for a given SHA and reused for subsequent mentions. Pure:
 * takes the raw stdout, returns structured lines in input order.
 */
export function parseBlamePorcelain(stdout: string): BlameLine[] {
	const out: BlameLine[] = [];
	const meta = new Map<
		string,
		{ author?: string; authorEmail?: string; authorTime?: number; summary?: string }
	>();
	const lines = stdout.split('\n');
	let currentSha: string | undefined;
	let currentLine = 0;
	let awaitingContent = false;

	for (const raw of lines) {
		if (awaitingContent && raw.startsWith('\t')) {
			const info = currentSha ? meta.get(currentSha) : undefined;
			if (currentSha && info) {
				out.push({
					sha: currentSha,
					line: currentLine,
					author: info.author ?? '',
					authorEmail: info.authorEmail ?? '',
					authorTime: info.authorTime ?? 0,
					summary: info.summary ?? '',
					content: raw.slice(1),
				});
			}
			awaitingContent = false;
			continue;
		}

		const header = raw.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
		if (header) {
			currentSha = header[1];
			currentLine = Number.parseInt(header[3], 10);
			awaitingContent = true;
			if (!meta.has(currentSha)) meta.set(currentSha, {});
			continue;
		}

		if (!currentSha) continue;
		const entry = meta.get(currentSha)!;
		if (raw.startsWith('author ')) entry.author = raw.slice(7);
		else if (raw.startsWith('author-mail ')) {
			entry.authorEmail = raw.slice(12).replace(/^<|>$/g, '');
		} else if (raw.startsWith('author-time ')) {
			entry.authorTime = Number.parseInt(raw.slice(12), 10);
		} else if (raw.startsWith('summary ')) entry.summary = raw.slice(8);
	}
	return out;
}

/**
 * For each commit touching `relPath` (following renames), record the path the
 * file had at that commit. Used to surface "renamed from X" affordances when
 * the path changes between adjacent entries in the file's log.
 */
export async function logFileRenames(
	repoRoot: string,
	relPath: string,
	maxCount: number,
): Promise<Map<string, string>> {
	const marker = '__TT_SHA__';
	const cmd = `git log --follow --max-count=${maxCount} --name-only --format=${shellQuote(marker + '%H')} -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return parsePathsByCommit(stdout, marker);
	} catch {
		return new Map();
	}
}

export function parsePathsByCommit(stdout: string, marker: string): Map<string, string> {
	const out = new Map<string, string>();
	let currentSha: string | undefined;
	for (const line of stdout.split('\n')) {
		if (line.startsWith(marker)) {
			currentSha = line.slice(marker.length).trim();
			continue;
		}
		const trimmed = line.trim();
		if (trimmed && currentSha && !out.has(currentSha)) {
			out.set(currentSha, trimmed);
		}
	}
	return out;
}

/**
 * Exit code 0 = clean, 1 = dirty. Any other error (path not in repo, etc.) is
 * treated as "can't tell" and returns false so we don't render a misleading
 * working-tree row.
 */
export async function isFileDirty(repoRoot: string, relPath: string): Promise<boolean> {
	const cmd = `git diff --quiet HEAD -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return false;
	} catch (err: unknown) {
		const code = (err as { code?: number } | undefined)?.code;
		return code === 1;
	}
}

export interface StashRecord {
	/** Ref as git names it: `stash@{0}`, `stash@{1}`, … */
	name: string;
	subject: string;
}

/**
 * `git stash list --format=%gd%x1F%s` — one record per line. The Git
 * extension API doesn't expose stashes, so we always shell out.
 */
export async function listStashes(repoRoot: string): Promise<StashRecord[]> {
	try {
		const { stdout } = await execAsync(`git stash list --format=${shellQuote('%gd%x1F%s')}`, {
			cwd: repoRoot,
			maxBuffer: MAX_BUFFER,
		});
		return parseStashList(stdout);
	} catch {
		return [];
	}
}

export function parseStashList(stdout: string): StashRecord[] {
	return stdout
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [name, subject] = line.split('\x1F');
			return { name: name ?? '', subject: subject ?? '' };
		})
		.filter((r) => r.name.length > 0);
}

/**
 * `git diff --unified=0 <ref> -- <path>` — just the hunk headers, no context
 * lines. Used by the CodeLens provider to position "Ask @historian" lenses above
 * each changed block.
 */
export async function getFileDiff(repoRoot: string, ref: string, relPath: string): Promise<string> {
	const cmd = `git diff --unified=0 ${shellQuote(ref)} -- ${shellQuote(relPath.replace(/\\/g, '/'))}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return stdout;
	} catch {
		return '';
	}
}

export interface CommitFileChange {
	path: string;
	additions: number;
	deletions: number;
	/** True when `--numstat` emits `-` for a binary file (no line counts). */
	binary: boolean;
}

/**
 * `git show --numstat --format= <sha>` — one line per file with
 * `<added>\t<deleted>\t<path>`. Binary files emit `-\t-\t<path>`.
 * Returns the file list in git's own order (roughly: path).
 */
export async function showCommitStat(repoRoot: string, sha: string): Promise<CommitFileChange[]> {
	try {
		const { stdout } = await execAsync(`git show --numstat --format= ${shellQuote(sha)}`, {
			cwd: repoRoot,
			maxBuffer: MAX_BUFFER,
		});
		return parseNumstat(stdout);
	} catch {
		return [];
	}
}

export function parseNumstat(stdout: string): CommitFileChange[] {
	const out: CommitFileChange[] = [];
	for (const raw of stdout.split('\n')) {
		const line = raw.trimEnd();
		if (!line) continue;
		const parts = line.split('\t');
		if (parts.length < 3) continue;
		const [addedStr, deletedStr, ...pathParts] = parts;
		const path = pathParts.join('\t');
		const binary = addedStr === '-' || deletedStr === '-';
		out.push({
			path,
			additions: binary ? 0 : Number.parseInt(addedStr, 10) || 0,
			deletions: binary ? 0 : Number.parseInt(deletedStr, 10) || 0,
			binary,
		});
	}
	return out;
}

/**
 * `git show --patch <sha>` — the full diff for a commit, optionally scoped to a
 * single path. Pinned to `-M` so renames show up as renames rather than big
 * delete+add pairs. Returns empty string on failure (unknown ref, etc.).
 */
export async function showCommitPatch(
	repoRoot: string,
	sha: string,
	relPath?: string,
): Promise<string> {
	const pathArg = relPath ? ` -- ${shellQuote(relPath.replace(/\\/g, '/'))}` : '';
	const cmd = `git show --patch -M --format= ${shellQuote(sha)}${pathArg}`;
	try {
		const { stdout } = await execAsync(cmd, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
		return stdout;
	} catch {
		return '';
	}
}

export async function getMergeBase(
	repoRoot: string,
	ref1: string,
	ref2: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await execAsync(`git merge-base ${shellQuote(ref1)} ${shellQuote(ref2)}`, {
			cwd: repoRoot,
			maxBuffer: MAX_BUFFER,
		});
		const trimmed = stdout.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	} catch {
		return undefined;
	}
}

export function parseLog(stdout: string): RawLogRecord[] {
	return stdout
		.split('\x1E')
		.map((record) => record.replace(/^\n+/, ''))
		.filter((record) => record.length > 0)
		.map((record) => {
			const [sha, shortSha, authorName, authorEmail, authorDate, parents, subject, body] =
				record.split('\x1F');
			return {
				sha,
				shortSha,
				authorName,
				authorEmail,
				authorDate,
				parents: parents ?? '',
				subject: subject ?? '',
				body: (body ?? '').trimEnd(),
			};
		});
}

export function relativeTo(repoRoot: string, absPath: string): string {
	return path.relative(repoRoot, absPath);
}

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
