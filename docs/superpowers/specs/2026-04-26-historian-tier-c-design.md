# Historian Tier C — Tool-Calling & Multi-Provider Design

**Date:** 2026-04-26
**Status:** Approved, ready for implementation

## Goal

Two big wins that need real architecture, not just glue:

1. **Tool-calling.** Let the model decide what evidence it needs, instead of us pre-loading everything. The current "stuff a 4k-character patch into the prompt and hope it's relevant" approach burns tokens and still misses the right context for half of all queries. Replace with on-demand tool invocation.
2. **Multi-provider PR context.** GitHub-only is a serious limitation. Add GitLab, Bitbucket, and GitHub Enterprise so PR/MR context shows up regardless of where the team hosts.

## Scope

In scope:

1. **`LanguageModelTool` registrations** — `searchCommits`, `getCommitDetails`, `getBlame`, `getDiff`, `findPRsForCommit`. The model picks which to call.
2. **Tool-calling prompt rewrite** — slim the upfront evidence to "selection + last 5 commits"; let the model pull more via tools.
3. **Provider-agnostic PR layer** — extract `PRProvider` interface; add `gitlab.ts`, `bitbucket.ts`, `gheServer.ts` (Enterprise) alongside the existing `github.ts`.
4. **Remote-host detection** — extend `parseRemoteUrl` to return `host: 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise'` plus the base URL for non-cloud hosts.
5. **Per-provider auth** — pluggable token resolution: GitHub session, GitLab session (via VS Code's GitLab Workflow extension if present, else a `timeTraveller.gitlab.token` setting), Bitbucket app password, GHE token from settings.

Out of scope:

- Self-hosted GitLab CE/EE deeper than basic API auth.
- Bitbucket Data Center (separate API surface).
- Tool-calling for non-`@historian` participants.
- Any UI for managing tokens — settings + auth provider sessions only.

---

## Change 1: Tool-calling architecture

### Current flow (what tier A/B left us with)

```
user prompt → gather all evidence (blame + log + diffs + PRs) → stuff into prompt → model responds
```

The model has _one shot_ with whatever we pre-loaded. If the answer needs a commit we didn't include, too bad.

### New flow

```
user prompt → minimal seed evidence → model loop:
  ├─ "I need the diff for abc1234" → tool call → result
  ├─ "I need the blame for lines 50-60" → tool call → result
  └─ "I have enough" → final response
```

### Tools to register

Each tool implements `vscode.LanguageModelTool<TInput>`. All tools live under `src/tools/`, one file per tool, plus a shared `register.ts`.

| Tool                             | Input                                                                  | Output                                             |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| `timeTraveller_searchCommits`    | `{ pattern: string, limit?: number }`                                  | List of `{ sha, shortSha, subject, author, date }` |
| `timeTraveller_getCommitDetails` | `{ sha: string, includeFiles?: bool }`                                 | Subject + body + files-changed (numstat)           |
| `timeTraveller_getCommitDiff`    | `{ sha: string, relPath?: string, maxChars? }`                         | Trimmed diff text                                  |
| `timeTraveller_getBlame`         | `{ relPath: string, startLine: number, endLine: number }`              | Blame-per-line array                               |
| `timeTraveller_findPRsForCommit` | `{ sha: string }`                                                      | PR summaries from the appropriate provider         |
| `timeTraveller_listFileHistory`  | `{ relPath: string, since?: string, author?: string, limit?: number }` | File log records                                   |

All tools receive the active workspace's `repoRoot` from a closure when they're registered — they don't accept it as input. This prevents prompt-injection attacks where the model is convinced to invoke tools against a different repo.

### Tool registration

`vscode.lm.registerTool(name, tool)` is the API. Each tool exposes:

```ts
class GetCommitDetailsTool implements vscode.LanguageModelTool<{
  sha: string;
  includeFiles?: boolean;
}> {
  async invoke(options, token) {
    // shell out via src/git/cli.ts, return LanguageModelToolResult
  }
  async prepareInvocation(options, token) {
    // optional confirmation + invocation message
    return {
      invocationMessage: `Reading commit ${options.input.sha.slice(0, 7)}...`,
    };
  }
}
```

### Slimmed prompt

`buildUserPrompt` learns a new mode flag (`toolCalling: true`) that emits only:

- Task description
- Selection or relPath
- Current baseline
- The 5 most recent commits on the file (so the model has enough to reason about _what to ask for_)

The model then calls tools to drill down. Average prompt length drops from ~6k tokens to ~1k tokens; per-call output may grow but total round-trip cost is lower for non-trivial questions.

### Handler loop

VS Code's chat API supports a tool-calling loop: when the model responds with a tool call, you call the tool and feed the result back, then re-invoke `model.sendRequest`. The handler grows a loop:

```ts
const tools: vscode.LanguageModelChatTool[] = listRegisteredTools();
let toolCalls: vscode.LanguageModelToolCallPart[] = [];
let loopCount = 0;
const MAX_LOOPS = 5; // hard cap to prevent runaway

while (loopCount++ < MAX_LOOPS) {
  const response = await model.sendRequest(messages, { tools }, token);
  toolCalls = [];
  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelTextPart) {
      stream.markdown(part.value);
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push(part);
    }
  }
  if (toolCalls.length === 0) break;
  for (const call of toolCalls) {
    const result = await vscode.lm.invokeTool(
      call.name,
      { input: call.input, toolInvocationToken: request.toolInvocationToken },
      token,
    );
    messages.push(/* tool result message */);
  }
}
```

### Fallback

If the chosen model doesn't support tool calling (older Copilot, some local providers), fall back to the Tier A pre-load behavior. Detection: try the tool-calling request; on `Unsupported` error, retry without tools.

### Configuration

| Setting                            | Default | Description                                     |
| ---------------------------------- | ------- | ----------------------------------------------- |
| `timeTraveller.chat.toolCalling`   | `true`  | Use tool calls when the model supports them     |
| `timeTraveller.chat.maxToolRounds` | `5`     | Maximum tool-call rounds per query (safety cap) |

---

## Change 2: Multi-provider PR layer

### Current shape

`src/pr/service.ts` calls `resolveGitHubRemote` then `fetchPRsForCommit`. Both are GitHub-specific.

### New shape

```
src/pr/
  service.ts           ← orchestrator (unchanged signature, multi-provider routing inside)
  cache.ts             ← unchanged
  provider.ts          ← NEW: PRProvider interface + registry
  github.ts            ← existing impl, adapted to PRProvider
  gitlab.ts            ← NEW
  bitbucket.ts         ← NEW
  gheServer.ts         ← NEW (GitHub Enterprise — same API, different base URL)
```

### `PRProvider` interface

```ts
export interface PRProvider {
  /** Stable id used in logs and config keys. */
  id: 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise';

  /** True if this provider should handle the given remote. Lets the registry
   * pick by host without the orchestrator knowing the impl. */
  matches(remote: RemoteInfo): boolean;

  /** Fetch PRs/MRs for a commit. Returns `undefined` on network error,
   * `[]` if there are none. Mirrors the existing GitHub contract. */
  fetchForCommit(args: FetchArgs): Promise<PRSummary[] | undefined>;

  /** Resolve an auth token if available, silently. Never prompts the user. */
  getToken(): Promise<string | undefined>;
}

export interface FetchArgs {
  remote: RemoteInfo;
  sha: string;
  token?: string;
}
```

### Remote detection

`src/remote.ts:parseRemoteUrl` already returns `{ host, owner, repo, baseUrl }`. Extend the host union:

```ts
type RemoteHost = 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise' | 'unknown';
```

Detection rules:

- `github.com` → `github`
- `gitlab.com` → `gitlab`
- `bitbucket.org` → `bitbucket`
- Self-hosted: a `timeTraveller.enterprise.hosts` setting maps `host → 'github-enterprise' | 'gitlab' | 'bitbucket'` for users to declare their on-prem hosts.
- Anything else → `unknown` (no PR lookup).

### Provider registry

`src/pr/provider.ts` exports a default registry:

```ts
export const DEFAULT_PROVIDERS: PRProvider[] = [
  new GitHubProvider(),
  new GitHubEnterpriseProvider(),
  new GitLabProvider(),
  new BitbucketProvider(),
];

export function pickProvider(
  remote: RemoteInfo,
  providers = DEFAULT_PROVIDERS,
): PRProvider | undefined;
```

`lookupPRs` calls `pickProvider(remote)` once per repo (not per SHA — the remote doesn't change mid-batch).

### Auth strategy per provider

| Provider          | Auth mechanism                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub            | `vscode.authentication.getSession('github', ['repo'], { silent, createIfNone: false })` — unchanged                                              |
| GitHub Enterprise | Same provider id (`'github-enterprise'`); GHE typically requires a personal access token via `timeTraveller.gheToken` setting                    |
| GitLab            | Try `vscode.authentication.getSession('gitlab', [...])` (provided by GitLab Workflow extension); fallback to `timeTraveller.gitlabToken` setting |
| Bitbucket         | App password via `timeTraveller.bitbucketAppPassword` setting (Bitbucket Cloud has no VS Code auth provider)                                     |

All settings are `string` defaults `""`. Empty = anonymous. Anonymous calls work for public repos, rate-limited.

### Endpoints

- **GitHub**: existing `GET /repos/{o}/{r}/commits/{sha}/pulls` (Accepts: `application/vnd.github.groot-preview+json`).
- **GitHub Enterprise**: same endpoint shape, baseUrl is `https://<host>/api/v3`.
- **GitLab**: `GET /projects/{id}/repository/commits/{sha}/merge_requests` — note `id` is URL-encoded `owner/repo`. State mapping: `merged → merged`, `opened → open`, `closed → closed`.
- **Bitbucket**: `GET /2.0/repositories/{workspace}/{repo}/commit/{sha}/pullrequests` — different envelope (`{ values: [...] }`); needs adapter to `PRSummary`.

### Cache compatibility

`PRCache` keys by SHA only. Multi-provider works as-is because we never have the same SHA on two providers in one repo.

---

## Change 3: User-facing settings

| Setting                              | Default | Description                                                                 |
| ------------------------------------ | ------- | --------------------------------------------------------------------------- |
| `timeTraveller.chat.toolCalling`     | `true`  | Use tool calls when supported                                               |
| `timeTraveller.chat.maxToolRounds`   | `5`     | Hard cap on tool-call rounds per query                                      |
| `timeTraveller.enterprise.hosts`     | `{}`    | Map of `<host>` → `"github-enterprise" \| "gitlab" \| "bitbucket"`          |
| `timeTraveller.gheToken`             | `""`    | Personal access token for GitHub Enterprise                                 |
| `timeTraveller.gitlabToken`          | `""`    | Personal access token for GitLab (used if GitLab Workflow extension absent) |
| `timeTraveller.bitbucketAppPassword` | `""`    | Bitbucket app password (`username:app-password` form)                       |

All token settings get `markdownDescription` warnings about treating the value as a secret and a pointer at VS Code's secrets storage for users who want stricter handling.

---

## Files changed

| File                               | Change                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `src/tools/searchCommits.ts` (new) | `LanguageModelTool` for log searches                                              |
| `src/tools/getCommitDetails.ts`    | Tool for `git show` metadata + numstat                                            |
| `src/tools/getCommitDiff.ts`       | Tool for trimmed `git show --patch`                                               |
| `src/tools/getBlame.ts`            | Tool for `git blame` on a range                                                   |
| `src/tools/findPRsForCommit.ts`    | Tool wrapping `lookupPRs` (single-SHA shortcut)                                   |
| `src/tools/listFileHistory.ts`     | Tool wrapping the existing log helpers                                            |
| `src/tools/register.ts` (new)      | Single entrypoint that registers all tools, returns disposables                   |
| `src/tools/*.test.ts` (new)        | One test file per tool covering input parsing + result shape                      |
| `src/chat.ts`                      | Tool-calling loop, fallback to non-tool path, slim prompt mode                    |
| `src/historian/prompt.ts`          | New `buildUserPrompt(... , { toolCalling: true })` mode that omits patch evidence |
| `src/historian/prompt.test.ts`     | Tests for tool-calling prompt mode                                                |
| `src/pr/provider.ts` (new)         | `PRProvider` interface + default registry + `pickProvider`                        |
| `src/pr/github.ts`                 | Refactored as a `GitHubProvider` class (default GitHub.com)                       |
| `src/pr/gheServer.ts` (new)        | `GitHubEnterpriseProvider` class                                                  |
| `src/pr/gitlab.ts` (new)           | `GitLabProvider` + tests                                                          |
| `src/pr/bitbucket.ts` (new)        | `BitbucketProvider` + tests                                                       |
| `src/pr/service.ts`                | Use `pickProvider`; adjust `PRLookupDeps` to take a provider, not raw fns         |
| `src/pr/service.test.ts`           | Update existing tests; add multi-provider routing cases                           |
| `src/remote.ts`                    | Extend `parseRemoteUrl` with new host types + Enterprise host config              |
| `src/remote.test.ts`               | Cases for gitlab/bitbucket URLs and `timeTraveller.enterprise.hosts` mapping      |
| `package.json`                     | New tool registrations under `contributes.languageModelTools`; new settings       |
| `test/mocks/vscode.ts`             | Mock `lm.registerTool`, `lm.invokeTool`, `LanguageModelTool*Part` classes         |
| `src/extension.ts`                 | Register tools in activation                                                      |
| `src/extension.smoke.test.ts`      | Assert tools are registered                                                       |
| `CHANGELOG.md`                     | Tier C entries                                                                    |

---

## Risk

- **Tool-calling complexity**: the loop is the most error-prone code in this tier. Mitigations: hard `MAX_LOOPS` cap, explicit `LanguageModelToolResult` schema, fallback path for non-supporting models.
- **Token costs**: tool calling can blow up cost if the model loops. The 5-round cap + status-bar progress prevents runaway without surprise bills.
- **Auth surface**: more places to leak tokens. Mitigation: settings are typed `string`; a follow-up can move them to VS Code's secret storage. Document the trade-off in `markdownDescription`.
- **Provider API drift**: GitLab and Bitbucket APIs change. Mitigation: each provider is a single file with one external call; update is a unit-test-driven swap.
- **GitLab self-hosted variance**: GitLab CE/EE has the same API surface as gitlab.com, but auth differs. The `timeTraveller.enterprise.hosts` map handles routing; auth per-host is out of scope (one shared token).
- **Test mock surface area**: tool-calling APIs (`LanguageModelToolCallPart`, etc.) need mock equivalents. They're constructible classes; the mock returns plain objects with the right shape.

## Definition of done

- `npm run kitchen-sink` passes.
- All six tools registered and invocable.
- `@historian` queries with selection-only context can pull commit details mid-conversation without us pre-loading them.
- A repo with a GitLab remote shows MR titles in `@historian` answers.
- A repo with a Bitbucket remote shows PR titles in `@historian` answers.
- A repo with a self-hosted GitHub host listed in `timeTraveller.enterprise.hosts` shows PRs.
- Fallback path works on Copilot models that lack tool support (no errors; behavior matches Tier B).
- Documentation in README updated with provider table and tool-calling explanation.
