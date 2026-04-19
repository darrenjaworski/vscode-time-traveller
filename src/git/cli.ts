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
