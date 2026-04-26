# Historian Tier C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `LanguageModelTool` registrations so the model can pull evidence on demand, and abstract the PR layer so GitLab, Bitbucket, and GitHub Enterprise repos all surface PR/MR context.

**Architecture:** Two independent threads — tools (sections A-D) and multi-provider PR (sections E-H). They can be implemented in parallel by different subagents.

**Tech Stack:** TypeScript, Vitest, VS Code Chat + Language Model APIs (`vscode.lm.registerTool`, `LanguageModelTool*` types).

**Order recommendation:** Land the multi-provider PR work first (Tasks 5-8) — smaller blast radius, no new prompt mode. Then the tool-calling work (Tasks 1-4).

---

## Section A: Multi-provider PR layer

### Task 5: Extract `PRProvider` interface, refactor existing GitHub impl (TDD)

**Files:**

- Create: `src/pr/provider.ts`
- Modify: `src/pr/github.ts` (refactor as `GitHubProvider` class implementing the interface)
- Modify: `src/pr/service.ts` (use the provider abstraction)
- Modify: `src/pr/service.test.ts` (update mocks for the new shape)
- Create: `src/pr/provider.test.ts`

- [x] **Step 1: Write a failing test for `pickProvider`**

Create `src/pr/provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { pickProvider, type PRProvider } from './provider';
import type { RemoteInfo } from '../remote';

const fake = (id: PRProvider['id'], host: RemoteInfo['host']): PRProvider => ({
  id,
  matches: (r) => r.host === host,
  fetchForCommit: async () => undefined,
  getToken: async () => undefined,
});

describe('pickProvider', () => {
  it('returns the first provider that matches', () => {
    const remote: RemoteInfo = { host: 'gitlab', owner: 'o', repo: 'r' };
    const out = pickProvider(remote, [fake('github', 'github'), fake('gitlab', 'gitlab')]);
    expect(out?.id).toBe('gitlab');
  });

  it('returns undefined when no provider matches', () => {
    const remote: RemoteInfo = { host: 'unknown' as RemoteInfo['host'], owner: 'o', repo: 'r' };
    expect(pickProvider(remote, [fake('github', 'github')])).toBeUndefined();
  });
});
```

- [x] **Step 2: Implement the `PRProvider` interface**

Create `src/pr/provider.ts`:

```typescript
import type { RemoteInfo } from '../remote';
import type { PRSummary } from './github';

export type PRProviderId = 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise';

export interface FetchArgs {
  remote: RemoteInfo;
  sha: string;
  token?: string;
}

export interface PRProvider {
  id: PRProviderId;
  matches(remote: RemoteInfo): boolean;
  fetchForCommit(args: FetchArgs): Promise<PRSummary[] | undefined>;
  getToken(): Promise<string | undefined>;
}

export function pickProvider(remote: RemoteInfo, providers: PRProvider[]): PRProvider | undefined {
  return providers.find((p) => p.matches(remote));
}
```

- [x] **Step 3: Run tests to confirm they pass**

```bash
npm test -- src/pr/provider.test.ts
```

- [x] **Step 4: Wrap existing GitHub impl as `GitHubProvider`**

In `src/pr/github.ts`, append the class export (keep the existing `fetchPRsForCommit` function for backward compat — `GitHubProvider` calls it):

```typescript
import * as vscode from 'vscode';
import type { PRProvider } from './provider';
import type { RemoteInfo } from '../remote';

export class GitHubProvider implements PRProvider {
  readonly id = 'github' as const;

  matches(remote: RemoteInfo): boolean {
    return remote.host === 'github';
  }

  async fetchForCommit(args: { remote: RemoteInfo; sha: string; token?: string }) {
    return fetchPRsForCommit({
      owner: args.remote.owner,
      repo: args.remote.repo,
      sha: args.sha,
      token: args.token,
    });
  }

  async getToken() {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone: false,
        silent: true,
      });
      return session?.accessToken;
    } catch {
      return undefined;
    }
  }
}
```

- [x] **Step 5: Refactor `service.ts` to use the registry**

Update `src/pr/service.ts`:

```typescript
import { pickProvider, type PRProvider } from './provider';
import { GitHubProvider } from './github';

export const DEFAULT_PROVIDERS: PRProvider[] = [new GitHubProvider()];

export interface PRLookupDeps {
  resolveRemote: (repoRoot: string) => Promise<RemoteInfo | undefined>;
  providers: PRProvider[];
}
```

In `lookupPRs`, replace the old `resolveGitHubRemote` + raw fetch wiring with:

```typescript
const remote = await deps.resolveRemote(input.repoRoot);
if (!remote) return /* cache miss → null for all uncached */;
const provider = pickProvider(remote, deps.providers);
if (!provider) return /* same null-cache fallthrough */;
const token = await provider.getToken();
// ...for each uncached sha: provider.fetchForCommit({ remote, sha, token })
```

- [x] **Step 6: Update existing service tests**

`src/pr/service.test.ts` already injects deps. Rewrite the dep object to use `providers: [fakeProvider]` and `resolveRemote: vi.fn(...)`. The existing 10 cases stay the same shape; only the dep names change.

- [x] **Step 7: Run all PR tests**

```bash
npm test -- src/pr/
```

Expected: PASS for service, github, cache, provider tests.

- [x] **Step 8: Commit**

```bash
git add src/pr/provider.ts src/pr/provider.test.ts src/pr/github.ts src/pr/service.ts src/pr/service.test.ts
git commit -m "refactor(pr): extract PRProvider interface; wrap GitHub as a provider"
```

---

### Task 6: GitLab provider (TDD)

**Files:**

- Create: `src/pr/gitlab.ts`
- Create: `src/pr/gitlab.test.ts`
- Modify: `src/pr/service.ts` (add to `DEFAULT_PROVIDERS`)

- [x] **Step 1: Write failing tests for the response adapter**

Create `src/pr/gitlab.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GitLabProvider, adaptGitLabMR } from './gitlab';
import type { RemoteInfo } from '../remote';

describe('adaptGitLabMR', () => {
  it('maps a merged MR to a PRSummary', () => {
    const mr = {
      iid: 42,
      title: 'Fix the bug',
      description: 'Body text',
      state: 'merged',
      web_url: 'https://gitlab.com/o/r/-/merge_requests/42',
      author: { username: 'alice' },
    };
    expect(adaptGitLabMR(mr)).toEqual({
      number: 42,
      title: 'Fix the bug',
      body: 'Body text',
      state: 'merged',
      merged: true,
      url: 'https://gitlab.com/o/r/-/merge_requests/42',
      author: 'alice',
    });
  });

  it('flags opened MRs as not merged', () => {
    const mr = {
      iid: 1,
      title: 't',
      description: '',
      state: 'opened',
      web_url: 'u',
      author: { username: 'a' },
    };
    expect(adaptGitLabMR(mr).merged).toBe(false);
    expect(adaptGitLabMR(mr).state).toBe('open');
  });
});

describe('GitLabProvider.matches', () => {
  it('matches gitlab hosts', () => {
    const remote: RemoteInfo = { host: 'gitlab', owner: 'o', repo: 'r' };
    expect(new GitLabProvider().matches(remote)).toBe(true);
  });
});
```

- [x] **Step 2: Implement `gitlab.ts`**

Create `src/pr/gitlab.ts`:

```typescript
import * as vscode from 'vscode';
import type { PRProvider } from './provider';
import type { PRSummary } from './github';
import type { RemoteInfo } from '../remote';

interface GitLabMR {
  iid: number;
  title: string;
  description: string;
  state: 'opened' | 'closed' | 'merged' | 'locked';
  web_url: string;
  author: { username: string };
}

export function adaptGitLabMR(mr: GitLabMR): PRSummary {
  const merged = mr.state === 'merged';
  return {
    number: mr.iid,
    title: mr.title,
    body: mr.description ?? '',
    state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed',
    merged,
    url: mr.web_url,
    author: mr.author.username,
  };
}

export class GitLabProvider implements PRProvider {
  readonly id = 'gitlab' as const;

  matches(remote: RemoteInfo): boolean {
    return remote.host === 'gitlab';
  }

  async fetchForCommit(args: { remote: RemoteInfo; sha: string; token?: string }) {
    const projectId = encodeURIComponent(`${args.remote.owner}/${args.remote.repo}`);
    const baseUrl = args.remote.baseUrl ?? 'https://gitlab.com';
    const url = `${baseUrl}/api/v4/projects/${projectId}/repository/commits/${args.sha}/merge_requests`;
    const headers: Record<string, string> = { 'User-Agent': 'vscode-time-traveller' };
    if (args.token) headers['PRIVATE-TOKEN'] = args.token;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return undefined;
      const data = (await res.json()) as GitLabMR[];
      return data.map(adaptGitLabMR);
    } catch {
      return undefined;
    }
  }

  async getToken() {
    try {
      const session = await vscode.authentication.getSession('gitlab', ['read_api'], {
        silent: true,
        createIfNone: false,
      });
      if (session?.accessToken) return session.accessToken;
    } catch {
      // GitLab session provider may not be installed
    }
    const cfg = vscode.workspace.getConfiguration('timeTraveller');
    return cfg.get<string>('gitlabToken') || undefined;
  }
}
```

- [x] **Step 3: Run tests to confirm pass**

- [x] **Step 4: Add to `DEFAULT_PROVIDERS`**

In `src/pr/service.ts`:

```typescript
import { GitLabProvider } from './gitlab';
export const DEFAULT_PROVIDERS: PRProvider[] = [new GitHubProvider(), new GitLabProvider()];
```

- [x] **Step 5: Add the `gitlabToken` setting in package.json**

```json
"timeTraveller.gitlabToken": {
  "type": "string",
  "default": "",
  "markdownDescription": "Personal access token for GitLab MR lookups. Used when the GitLab Workflow extension is not installed. Treat as a secret."
}
```

- [x] **Step 6: Commit**

```bash
git add src/pr/gitlab.ts src/pr/gitlab.test.ts src/pr/service.ts package.json
git commit -m "feat(pr): GitLab provider with MR lookup and token fallback"
```

---

### Task 7: Bitbucket and GitHub Enterprise providers (TDD)

**Files:**

- Create: `src/pr/bitbucket.ts` + `src/pr/bitbucket.test.ts`
- Create: `src/pr/gheServer.ts` + `src/pr/gheServer.test.ts`
- Modify: `src/pr/service.ts` (add to `DEFAULT_PROVIDERS`)
- Modify: `package.json` (settings: `bitbucketAppPassword`, `gheToken`, `enterprise.hosts`)

- [x] **Step 1: Bitbucket — failing test for response adapter**

Create `src/pr/bitbucket.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { adaptBitbucketPR } from './bitbucket';

describe('adaptBitbucketPR', () => {
  it('maps a merged PR to a PRSummary', () => {
    const pr = {
      id: 7,
      title: 'Refactor',
      description: 'desc',
      state: 'MERGED',
      links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/7' } },
      author: { display_name: 'Alice', nickname: 'alice' },
    };
    const out = adaptBitbucketPR(pr);
    expect(out.number).toBe(7);
    expect(out.merged).toBe(true);
    expect(out.state).toBe('merged');
    expect(out.author).toBe('alice');
  });
});
```

- [x] **Step 2: Implement `bitbucket.ts`**

Create `src/pr/bitbucket.ts`:

```typescript
import * as vscode from 'vscode';
import type { PRProvider } from './provider';
import type { PRSummary } from './github';
import type { RemoteInfo } from '../remote';

interface BitbucketPR {
  id: number;
  title: string;
  description: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  links: { html: { href: string } };
  author: { display_name: string; nickname?: string };
}

export function adaptBitbucketPR(pr: BitbucketPR): PRSummary {
  const merged = pr.state === 'MERGED';
  return {
    number: pr.id,
    title: pr.title,
    body: pr.description ?? '',
    state: merged ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed',
    merged,
    url: pr.links.html.href,
    author: pr.author.nickname ?? pr.author.display_name,
  };
}

export class BitbucketProvider implements PRProvider {
  readonly id = 'bitbucket' as const;

  matches(remote: RemoteInfo): boolean {
    return remote.host === 'bitbucket';
  }

  async fetchForCommit(args: { remote: RemoteInfo; sha: string; token?: string }) {
    const url = `https://api.bitbucket.org/2.0/repositories/${args.remote.owner}/${args.remote.repo}/commit/${args.sha}/pullrequests`;
    const headers: Record<string, string> = { 'User-Agent': 'vscode-time-traveller' };
    if (args.token)
      headers['Authorization'] = `Basic ${Buffer.from(args.token).toString('base64')}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { values?: BitbucketPR[] };
      return (data.values ?? []).map(adaptBitbucketPR);
    } catch {
      return undefined;
    }
  }

  async getToken() {
    const cfg = vscode.workspace.getConfiguration('timeTraveller');
    return cfg.get<string>('bitbucketAppPassword') || undefined;
  }
}
```

- [x] **Step 3: GHE — failing test**

Create `src/pr/gheServer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GitHubEnterpriseProvider } from './gheServer';

describe('GitHubEnterpriseProvider', () => {
  it('matches github-enterprise host', () => {
    const p = new GitHubEnterpriseProvider();
    expect(
      p.matches({
        host: 'github-enterprise',
        owner: 'o',
        repo: 'r',
        baseUrl: 'https://ghe.example/api/v3',
      }),
    ).toBe(true);
    expect(p.matches({ host: 'github', owner: 'o', repo: 'r' })).toBe(false);
  });
});
```

- [x] **Step 4: Implement `gheServer.ts`**

```typescript
import * as vscode from 'vscode';
import type { PRProvider } from './provider';
import type { PRSummary } from './github';
import type { RemoteInfo } from '../remote';
import { fetchPRsForCommit } from './github';

export class GitHubEnterpriseProvider implements PRProvider {
  readonly id = 'github-enterprise' as const;

  matches(remote: RemoteInfo): boolean {
    return remote.host === 'github-enterprise';
  }

  async fetchForCommit(args: {
    remote: RemoteInfo;
    sha: string;
    token?: string;
  }): Promise<PRSummary[] | undefined> {
    return fetchPRsForCommit({
      owner: args.remote.owner,
      repo: args.remote.repo,
      sha: args.sha,
      token: args.token,
      baseUrl: args.remote.baseUrl,
    });
  }

  async getToken() {
    const cfg = vscode.workspace.getConfiguration('timeTraveller');
    return cfg.get<string>('gheToken') || undefined;
  }
}
```

(`fetchPRsForCommit` in `github.ts` needs an optional `baseUrl` parameter — small surgical edit.)

- [x] **Step 5: Update `github.ts` to support a custom baseUrl**

Find the URL construction in `fetchPRsForCommit`:

```typescript
const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/pulls`;
```

Replace:

```typescript
const url = `${args.baseUrl ?? 'https://api.github.com'}/repos/${args.owner}/${args.repo}/commits/${args.sha}/pulls`;
```

Add `baseUrl?: string` to the args type.

- [x] **Step 6: Add settings to package.json**

```json
"timeTraveller.bitbucketAppPassword": {
  "type": "string",
  "default": "",
  "markdownDescription": "Bitbucket app password in `username:password` form for PR lookups. Treat as a secret."
},
"timeTraveller.gheToken": {
  "type": "string",
  "default": "",
  "markdownDescription": "Personal access token for GitHub Enterprise (used for PR lookups)."
},
"timeTraveller.enterprise.hosts": {
  "type": "object",
  "default": {},
  "markdownDescription": "Map of self-hosted hostnames to provider type. Example: `{ \"git.acme.corp\": \"github-enterprise\" }`."
}
```

- [x] **Step 7: Wire all three into `DEFAULT_PROVIDERS`**

```typescript
export const DEFAULT_PROVIDERS: PRProvider[] = [
  new GitHubProvider(),
  new GitHubEnterpriseProvider(),
  new GitLabProvider(),
  new BitbucketProvider(),
];
```

- [x] **Step 8: Run all tests**

```bash
npm test -- src/pr/
```

- [x] **Step 9: Commit**

```bash
git add src/pr/bitbucket.ts src/pr/bitbucket.test.ts src/pr/gheServer.ts src/pr/gheServer.test.ts src/pr/github.ts src/pr/service.ts package.json
git commit -m "feat(pr): Bitbucket and GitHub Enterprise providers"
```

---

### Task 8: Remote-host detection for non-GitHub hosts (TDD)

**Files:**

- Modify: `src/remote.ts`
- Modify: `src/remote.test.ts`

- [x] **Step 1: Write failing tests in `src/remote.test.ts`**

```typescript
describe('parseRemoteUrl — multi-host', () => {
  it('detects gitlab.com', () => {
    expect(parseRemoteUrl('git@gitlab.com:group/project.git')).toEqual({
      host: 'gitlab',
      owner: 'group',
      repo: 'project',
    });
  });

  it('detects bitbucket.org', () => {
    expect(parseRemoteUrl('https://bitbucket.org/team/repo.git')).toEqual({
      host: 'bitbucket',
      owner: 'team',
      repo: 'repo',
    });
  });

  it('returns github-enterprise when host is in enterprise config', () => {
    const out = parseRemoteUrl('git@git.acme.corp:team/repo.git', {
      enterpriseHosts: { 'git.acme.corp': 'github-enterprise' },
    });
    expect(out?.host).toBe('github-enterprise');
    expect(out?.baseUrl).toBe('https://git.acme.corp/api/v3');
  });
});
```

- [x] **Step 2: Update `parseRemoteUrl` signature and logic**

```typescript
export type RemoteHost = 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise' | 'unknown';

export interface RemoteInfo {
  host: RemoteHost;
  owner: string;
  repo: string;
  /** Used by Enterprise / self-hosted providers. */
  baseUrl?: string;
}

export interface ParseOptions {
  enterpriseHosts?: Record<string, 'github-enterprise' | 'gitlab' | 'bitbucket'>;
}

export function parseRemoteUrl(url: string, opts: ParseOptions = {}): RemoteInfo | undefined {
  // ...existing parse to extract { hostname, owner, repo } ...
  if (hostname === 'github.com') return { host: 'github', owner, repo };
  if (hostname === 'gitlab.com') return { host: 'gitlab', owner, repo };
  if (hostname === 'bitbucket.org') return { host: 'bitbucket', owner, repo };
  const ent = opts.enterpriseHosts?.[hostname];
  if (ent === 'github-enterprise')
    return { host: 'github-enterprise', owner, repo, baseUrl: `https://${hostname}/api/v3` };
  if (ent === 'gitlab') return { host: 'gitlab', owner, repo, baseUrl: `https://${hostname}` };
  if (ent === 'bitbucket') return { host: 'bitbucket', owner, repo };
  return { host: 'unknown', owner, repo };
}
```

- [x] **Step 3: Pass the enterprise-host map at the call site**

`resolveRemote` (or the equivalent in `pr/service.ts`) reads `vscode.workspace.getConfiguration('timeTraveller').get<Record<string, ...>>('enterprise.hosts')` and passes it through.

- [x] **Step 4: Update existing callers**

`src/remote.ts` is also used by the history panel's "Open on remote" command. That code path doesn't care about the new `host` values — anything other than `github`/`gitlab`/`bitbucket` already falls through to "unsupported". Verify by running the suite.

- [x] **Step 5: Run tests**

```bash
npm test
```

Expected: all pass, including new remote.test.ts cases.

- [x] **Step 6: Commit**

```bash
git add src/remote.ts src/remote.test.ts src/pr/service.ts
git commit -m "feat(remote): detect gitlab/bitbucket and configurable enterprise hosts"
```

---

## Section B: Tool calling

### Task 1: Tool scaffolding — registration entrypoint and one tool (TDD)

**Files:**

- Create: `src/tools/getCommitDetails.ts`
- Create: `src/tools/getCommitDetails.test.ts`
- Create: `src/tools/register.ts`
- Modify: `src/extension.ts` (call `registerTools` in activation)
- Modify: `package.json` (declare the tool under `contributes.languageModelTools`)
- Modify: `test/mocks/vscode.ts` (mock `lm.registerTool`, `LanguageModelTool*` shapes)

Pick `getCommitDetails` as the first tool because it has the simplest input shape and clear test surface.

- [x] **Step 1: Extend the vscode mock**

In `test/mocks/vscode.ts`, add to the top-level `lm` namespace:

```typescript
registerTool: vi.fn((name, tool) => ({ dispose: () => {} })),
invokeTool: vi.fn(),
```

Add result-part shapes:

```typescript
export class LanguageModelTextPart {
  constructor(public value: string) {}
}
export class LanguageModelToolResult {
  constructor(public content: LanguageModelTextPart[]) {}
}
```

- [x] **Step 2: Write a failing test**

Create `src/tools/getCommitDetails.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GetCommitDetailsTool } from './getCommitDetails';

describe('GetCommitDetailsTool', () => {
  it('returns formatted output for a known commit', async () => {
    const tool = new GetCommitDetailsTool({
      repoRoot: '/repo',
      gitShow: vi.fn().mockResolvedValue({
        sha: 'a'.repeat(40),
        subject: 'Fix bug',
        body: 'Detail',
        authorName: 'Alice',
        authorDate: new Date('2026-01-01'),
        files: [{ path: 'src/x.ts', additions: 3, deletions: 1, binary: false }],
      }),
    });
    const result = await tool.invoke({ input: { sha: 'aaaa', includeFiles: true } }, undefined);
    const text = (result.content[0] as any).value;
    expect(text).toContain('Fix bug');
    expect(text).toContain('src/x.ts');
  });
});
```

- [x] **Step 3: Implement `GetCommitDetailsTool`**

Create `src/tools/getCommitDetails.ts`:

```typescript
import * as vscode from 'vscode';

export interface CommitDetails {
  sha: string;
  subject: string;
  body: string;
  authorName: string;
  authorDate: Date;
  files: Array<{ path: string; additions: number; deletions: number; binary: boolean }>;
}

export interface GetCommitDetailsDeps {
  repoRoot: string;
  gitShow: (sha: string) => Promise<CommitDetails>;
}

export class GetCommitDetailsTool implements vscode.LanguageModelTool<{
  sha: string;
  includeFiles?: boolean;
}> {
  constructor(private readonly deps: GetCommitDetailsDeps) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ sha: string; includeFiles?: boolean }>,
  ): Promise<vscode.LanguageModelToolResult> {
    const details = await this.deps.gitShow(options.input.sha);
    const lines = [
      `Commit \`${details.sha.slice(0, 7)}\``,
      `Author: ${details.authorName}`,
      `Date: ${details.authorDate.toISOString()}`,
      '',
      details.subject,
      '',
      details.body,
    ];
    if (options.input.includeFiles) {
      lines.push('', 'Files changed:');
      for (const f of details.files) {
        lines.push(
          f.binary ? `- ${f.path} (binary)` : `- ${f.path} (+${f.additions} -${f.deletions})`,
        );
      }
    }
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join('\n'))]);
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<{ sha: string }>,
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: `Reading commit ${options.input.sha.slice(0, 7)}…`,
    };
  }
}
```

- [x] **Step 4: Run tests to confirm pass**

```bash
npm test -- src/tools/getCommitDetails.test.ts
```

- [x] **Step 5: Implement `register.ts`**

Create `src/tools/register.ts`:

```typescript
import * as vscode from 'vscode';
import { GetCommitDetailsTool } from './getCommitDetails';
// imports for other tools added in later tasks

export function registerTools(repoRoot: string): vscode.Disposable[] {
  return [
    vscode.lm.registerTool(
      'timeTraveller_getCommitDetails',
      new GetCommitDetailsTool({
        repoRoot,
        gitShow: /* wire to src/git/cli.ts */ async (sha) =>
          ({
            /* ... */
          }) as any,
      }),
    ),
  ];
}
```

(The wiring to `git/cli.ts` lives in `register.ts` so the tool class stays test-friendly.)

- [x] **Step 6: Declare in package.json**

Under `contributes`, add:

```json
"languageModelTools": [
  {
    "name": "timeTraveller_getCommitDetails",
    "displayName": "Get commit details",
    "modelDescription": "Read a commit's metadata (subject, body, author, date) and optionally its files-changed list. Use when you need to understand what a specific commit did.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sha": { "type": "string", "description": "Full or short SHA" },
        "includeFiles": { "type": "boolean", "description": "Include the files-changed list (numstat)" }
      },
      "required": ["sha"]
    }
  }
]
```

- [x] **Step 7: Wire into `extension.ts` activation**

```typescript
import { registerTools } from './tools/register';
// later, after baseline + repo lookup:
const editor = vscode.window.activeTextEditor;
if (editor) {
  const repo = await findRepository(editor.document.uri);
  if (repo) context.subscriptions.push(...registerTools(repo.rootUri.fsPath));
}
```

(Workspace-folder-scoped registration is fine for now. Multi-root is a follow-up.)

- [x] **Step 8: Verify typecheck and tests**

```bash
npm run typecheck && npm test
```

- [x] **Step 9: Commit**

```bash
git add src/tools/ src/extension.ts package.json test/mocks/vscode.ts
git commit -m "feat(tools): scaffolding + getCommitDetails tool"
```

---

### Task 2: Remaining tools (TDD, one commit each)

For each tool, follow the same TDD pattern: failing test → impl → registration → commit. Inputs and outputs are listed in the spec. Copy the structure from Task 1.

- [x] **Step 1: `searchCommits`** — wraps `git log --grep=<pattern> --max-count=<limit>`. Test: input pattern → returns array of commit headers.
- [x] **Step 2: `getCommitDiff`** — wraps `showCommitPatch` + `trimPatch`. Test: respects `maxChars`.
- [x] **Step 3: `getBlame`** — wraps `blameRange`. Test: returns blame lines for a range.
- [x] **Step 4: `findPRsForCommit`** — wraps `lookupPRs` for a single SHA. Test: returns formatted PR text or "No PRs".
- [x] **Step 5: `listFileHistory`** — wraps `logFile` / `logFileSince` / `logFileByAuthor`. Test: respects since/author filters.

Each tool gets:

- A `<name>.ts` file with a class implementing `LanguageModelTool`
- A `<name>.test.ts` with at least 2 cases (happy path + edge case)
- An entry in `register.ts`
- An entry in `package.json` `contributes.languageModelTools`
- One commit per tool: `feat(tools): <toolName> tool`

After all five lands, run `npm test` and `npm run typecheck` and confirm green.

---

### Task 3: Tool-calling loop in the handler

**Files:**

- Modify: `src/chat.ts` (handler loop)
- Modify: `src/historian/prompt.ts` (add `toolCalling` mode)
- Modify: `src/historian/prompt.test.ts` (test new mode)
- Modify: `package.json` (add `toolCalling`, `maxToolRounds` settings)

- [x] **Step 1: Add slim-prompt mode tests**

In `prompt.test.ts`:

```typescript
it('emits a slim prompt when toolCalling is true', () => {
  const ev = baseEv({
    fileCommits: Array.from({ length: 20 }, (_, i) =>
      recordToSummary(rec(String(i).padStart(40, '0'))),
    ),
    commitDiffs: new Map([['x', 'huge diff']]),
  });
  const slim = buildUserPrompt(ev, 'default', '', undefined, { toolCalling: true });
  expect(slim).not.toContain('huge diff');
  expect(slim.split('\n').filter((l) => l.includes('`'))).toHaveLength(/* ~5 commit lines */);
});
```

- [x] **Step 2: Add the `options` parameter to `buildUserPrompt`**

Signature:

```typescript
export function buildUserPrompt(
  evidence: Evidence,
  command: HistorianCommand,
  userPrompt: string,
  now: Date = new Date(),
  options: { toolCalling?: boolean } = {},
): string;
```

When `options.toolCalling` is true, skip the diff/PR/files-changed sections and cap the file log at 5.

- [x] **Step 3: Run prompt tests; commit**

```bash
git add src/historian/prompt.ts src/historian/prompt.test.ts
git commit -m "feat(historian): slim prompt mode for tool-calling"
```

- [x] **Step 4: Add settings**

```json
"timeTraveller.chat.toolCalling": {
  "type": "boolean",
  "default": true,
  "description": "Allow the model to invoke `@historian` tools to pull evidence on demand."
},
"timeTraveller.chat.maxToolRounds": {
  "type": "integer",
  "default": 5,
  "minimum": 1,
  "maximum": 20,
  "description": "Maximum tool-call rounds per query."
}
```

- [x] **Step 5: Implement the tool-calling loop in `src/chat.ts`**

Replace the simple `model.sendRequest` block with a loop. Pseudo-code (full implementation in the spec):

```typescript
const toolCallingEnabled = chatCfg.get<boolean>('toolCalling', true);
const maxRounds = chatCfg.get<number>('maxToolRounds', 5);

if (toolCallingEnabled) {
  const tools = vscode.lm.tools.filter((t) => t.name.startsWith('timeTraveller_'));
  // run loop, fall back to non-tool path on Unsupported error
} else {
  // existing single-shot path
}
```

Build the user prompt with `{ toolCalling: true }` when entering the tool path; the regular path uses the default.

- [x] **Step 6: Add a fallback test (mock model rejects with "Unsupported")**

A small unit test that the handler swallows `Unsupported` and falls back. Easier to do with an injectable model — for now, just verify by hand and add a smoke test stub.

- [x] **Step 7: Run tests**

```bash
npm run typecheck && npm test
```

- [x] **Step 8: Commit**

```bash
git add src/chat.ts package.json
git commit -m "feat(historian): tool-calling loop with slim prompt and fallback"
```

---

### Task 4: Final verification

- [x] **Step 1: Run kitchen-sink**

```bash
npm run kitchen-sink
```

- [x] **Step 2: Definition of done**

- All 6 tools registered (`timeTraveller_searchCommits`, `_getCommitDetails`, `_getCommitDiff`, `_getBlame`, `_findPRsForCommit`, `_listFileHistory`).
- `package.json` declares all 6 under `contributes.languageModelTools`.
- `buildUserPrompt` has `toolCalling` mode that omits diff/PR sections.
- `src/chat.ts` runs a tool-call loop with a `MAX_LOOPS` safety cap.
- `src/pr/` has `provider.ts`, `gitlab.ts`, `bitbucket.ts`, `gheServer.ts`.
- `parseRemoteUrl` returns `host: 'gitlab'` / `'bitbucket'` / `'github-enterprise'` correctly.
- `package.json` declares: `toolCalling`, `maxToolRounds`, `gitlabToken`, `bitbucketAppPassword`, `gheToken`, `enterprise.hosts`.
- Smoke test asserts the new tool registrations.

- [x] **Step 3: Update CHANGELOG**

```markdown
### Added (Tier C)

- **Tool calling.** `@historian` now lets the model pull evidence on demand — commit details, blame, diffs, PR data — instead of relying on a pre-loaded prompt. Toggle via `timeTraveller.chat.toolCalling`.
- **GitLab MR context** for repos with a GitLab remote.
- **Bitbucket PR context** for repos with a Bitbucket Cloud remote.
- **GitHub Enterprise support** via `timeTraveller.enterprise.hosts` and `timeTraveller.gheToken`.
- New settings: `timeTraveller.gitlabToken`, `timeTraveller.bitbucketAppPassword`, `timeTraveller.gheToken`, `timeTraveller.enterprise.hosts`, `timeTraveller.chat.toolCalling`, `timeTraveller.chat.maxToolRounds`.
```

- [x] **Step 4: Update README**

Add a "Supported hosts" table and a paragraph on tool calling.

- [x] **Step 5: Push**

```bash
git push origin main
```
