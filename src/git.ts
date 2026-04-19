import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';

const execFile = promisify(exec);

export async function showFileAtRef(
	repoRoot: string,
	ref: string,
	relPath: string,
): Promise<string> {
	const spec = `${ref}:${relPath.replace(/\\/g, '/')}`;
	try {
		const { stdout } = await execFile(`git show ${shellQuote(spec)}`, {
			cwd: repoRoot,
			maxBuffer: 50 * 1024 * 1024,
		});
		return stdout;
	} catch {
		return '';
	}
}

export function relativeTo(repoRoot: string, absPath: string): string {
	return path.relative(repoRoot, absPath);
}

function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}
