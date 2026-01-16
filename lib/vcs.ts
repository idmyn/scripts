import { $ } from "bun";

export async function getBranchName(): Promise<string> {
  // Check if we're in a jj repository first
  const isJjRepo = await $`jj root`
    .nothrow()
    .quiet()
    .then((r) => r.exitCode === 0);

  if (isJjRepo) {
    // In jj repo, get bookmark name
    const bookmarkName = (
      await $`jj bookmark list -r "closest_bookmark(@)" -T "json(self)" | jq -r '.name'`.text()
    ).trim();
    return bookmarkName;
  }

  // Fall back to git
  const isGitRepo = await $`git rev-parse --git-dir`
    .nothrow()
    .quiet()
    .then((r) => r.exitCode === 0);

  if (isGitRepo) {
    // In git repo, get current branch name
    const branchName = (
      await $`git rev-parse --abbrev-ref HEAD`.text()
    ).trim();
    return branchName;
  }

  // Not in any repo
  console.error("Error: Not in a git or jj repository");
  process.exit(1);
}

export async function getRepoInfo(): Promise<{
  repoArg: string;
  owner: string;
  repo: string;
}> {
  // Check if we're in a git repository
  const isGitRepo = await $`git rev-parse --git-dir`
    .nothrow()
    .quiet()
    .then((r) => r.exitCode === 0);

  let repoIdentifier: string;

  if (isGitRepo) {
    // In git repo, gh can auto-detect but we still need owner/repo for GraphQL
    try {
      repoIdentifier = (
        await $`gh repo view --json nameWithOwner --jq '.nameWithOwner'`.text()
      ).trim();
    } catch (error) {
      console.error("Error: Could not get repository information from GitHub. Make sure you have a remote configured.");
      process.exit(1);
    }
  } else {
    // Not in git repo, get from jj
    const remoteListOutput = await $`jj git remote list`.text();
    let originUrl = "";

    for (const line of remoteListOutput.trim().split("\n")) {
      const [remoteName, remoteUrl] = line.split(/\s+/);
      if (remoteName === "origin" && remoteUrl) {
        originUrl = remoteUrl;
        break;
      }
    }

    if (!originUrl) {
      console.error('Error: No "origin" remote found in jj git remote list');
      process.exit(1);
    }

    // Parse GitHub URL (SSH or HTTPS)
    const sshMatch = originUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
    const httpsMatch = originUrl.match(
      /https:\/\/github\.com\/(.+?)(?:\.git)?$/,
    );

    if (sshMatch?.[1]) {
      repoIdentifier = sshMatch[1];
    } else if (httpsMatch?.[1]) {
      repoIdentifier = httpsMatch[1];
    } else {
      console.error(`Error: Could not parse GitHub URL: ${originUrl}`);
      process.exit(1);
    }
  }

  const [owner, repo] = repoIdentifier.split("/");

  if (!owner || !repo) {
    console.error(`Error: Invalid repository identifier: ${repoIdentifier}`);
    process.exit(1);
  }

  const repoArg = `--repo=${repoIdentifier}`;

  return { repoArg, owner, repo };
}
