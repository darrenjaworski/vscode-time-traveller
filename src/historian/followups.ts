/**
 * Pure producer of chat follow-up prompts. Returned from the participant's
 * `followupProvider` so users get one-click drill-downs after an answer.
 *
 * Kept free of `vscode` so the suggestions can be reviewed in isolation.
 */
import type { HistorianCommand } from './prompt';
import type { Evidence } from './evidence';

export interface HistorianFollowup {
	label: string;
	prompt: string;
	command?: HistorianCommand;
}

const MAX_FOLLOWUPS = 4;

export function suggestFollowups(
	command: HistorianCommand,
	evidence: Evidence,
): HistorianFollowup[] {
	const out: HistorianFollowup[] = [];
	const mostRecent = evidence.fileCommits[0];
	const topReferenced = evidence.referencedCommits[0];
	const topBlame = evidence.blameLines?.[0];

	if (command !== 'story') {
		out.push({ label: 'Tell the full story of this file', prompt: '', command: 'story' });
	}
	if (command !== 'default' && command !== 'why') {
		out.push({
			label: 'Why do the selected lines look this way?',
			prompt: '',
			command: 'why',
		});
	}

	if (mostRecent) {
		out.push({
			label: `Why did ${mostRecent.shortSha} change this file?`,
			prompt: `Why did commit ${mostRecent.shortSha} (${mostRecent.subject}) change this file?`,
		});
	}

	if (topReferenced && topReferenced.sha !== mostRecent?.sha) {
		out.push({
			label: `Compare ${topReferenced.shortSha} to the previous revision`,
			prompt: `What changed in commit ${topReferenced.shortSha} compared to the one before it?`,
		});
	}

	if (topBlame && topBlame.author) {
		out.push({
			label: `Other changes by ${topBlame.author} on this file`,
			prompt: topBlame.author,
			command: 'author',
		});
	}

	return out.slice(0, MAX_FOLLOWUPS);
}
