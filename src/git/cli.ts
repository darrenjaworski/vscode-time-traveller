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
