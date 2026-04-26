import type { Evidence } from './evidence';

export interface ActionButton {
	command: string;
	arguments: unknown[];
	title: string;
	tooltip?: string;
}

const MAX_BUTTONS = 3;

export function suggestActionButtons(evidence: Evidence): ActionButton[] {
	const sha = pickPrimarySha(evidence);
	if (!sha) return [];
	const shortSha = sha.slice(0, 7);
	return [
		{
			command: 'timeTraveller.history.setBaseline',
			arguments: [sha],
			title: `Set ${shortSha} as baseline`,
			tooltip: 'Make this commit the diff baseline for the current file',
		},
		{
			command: 'timeTraveller.openDiffWithBaseline',
			arguments: [],
			title: 'Open diff vs current baseline',
		},
		{
			command: 'timeTraveller.history.copySha',
			arguments: [sha],
			title: 'Copy SHA',
		},
	].slice(0, MAX_BUTTONS);
}

function pickPrimarySha(evidence: Evidence): string | undefined {
	if (evidence.referencedCommits.length > 0) return evidence.referencedCommits[0].sha;
	const blame = evidence.blameLines ?? [];
	if (blame.length === 0) return undefined;
	const counts = new Map<string, number>();
	for (const l of blame) counts.set(l.sha, (counts.get(l.sha) ?? 0) + 1);
	let topSha: string | undefined;
	let topCount = 0;
	for (const [sha, n] of counts) {
		if (n > topCount) {
			topSha = sha;
			topCount = n;
		}
	}
	return topSha;
}
