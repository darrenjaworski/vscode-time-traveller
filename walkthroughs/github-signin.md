# (Optional) Sign in to GitHub

When the active repo has a GitHub remote, `@historian` automatically looks up the **pull request** associated with each cited commit and folds the PR title + body into its prompt. Answers can cite `PR #42` alongside the commit SHA.

Time Traveller uses VS Code's built-in GitHub auth **silently** — you're never prompted during a chat. The extension calls:

```
vscode.authentication.getSession('github', ['repo'], {
  silent: true,
  createIfNone: false,
})
```

So PR context just works once you've signed in to GitHub from anywhere in VS Code.

**Unauthenticated use** still works on public repos, but the GitHub API rate-limits anonymous calls at 60/hour/IP. Signing in bumps that to 5,000/hour.

**Not supported yet** — GitLab, Bitbucket, Enterprise GitHub, PR review comments.

> **Privacy note:** Only commit SHAs are sent to GitHub; diff content stays local. The PR lookup is session-scoped and caches known-absent commits so repeat queries don't re-hit the API.
