import { $ } from "bun";

/**
 * Get PR comments by PR number using GitHub GraphQL API
 * @param prNumber - The pull request number
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Raw JSON string from GitHub GraphQL API
 * @throws Error if GitHub API call fails
 */
export async function getPrComments(
  prNumber: string,
  owner: string,
  repo: string
): Promise<string> {
  const result = await $`gh api graphql -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          comments(first: 100) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              isCollapsed
              isOutdated
              comments(first: 100) {
                nodes {
                  author { login }
                  body
                  path
                  line
                  createdAt
                  isMinimized
                  minimizedReason
                }
              }
            }
          }
        }
      }
    }
    ' -f owner=${owner} -f repo=${repo} -F number=${prNumber}`.text();
  return result;
}

/**
 * Get PR comments for a branch by fetching the PR number first
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branchName - Branch/bookmark name
 * @returns Raw JSON string from GitHub GraphQL API
 * @throws Error if PR not found or GitHub API call fails
 */
export async function getPrCommentsForBranch(
  owner: string,
  repo: string,
  branchName: string
): Promise<string> {
  const prNumber = (
    await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number --jq '.[0].number'`.text()
  ).trim();

  if (!prNumber) {
    throw new Error(`No PR found for branch: ${branchName}`);
  }

  return getPrComments(prNumber, owner, repo);
}
