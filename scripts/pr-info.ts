import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { $ } from "bun";
import process from "node:process";
import { getRepoInfo, getBranchName } from "$lib/vcs";
import { getPrCommentsForBranch } from "$lib/github";

const description = buildCommand({
  async func(this: CommandContext) {
    const { owner, repo } = await getRepoInfo();
    const branchName = await getBranchName();

    await $`gh pr view --repo ${owner}/${repo} ${branchName}`;
  },
  parameters: {},
  docs: {
    brief: "Show PR description for current branch",
  },
});

const diff = buildCommand({
  async func(this: CommandContext) {
    const { owner, repo } = await getRepoInfo();
    const branchName = await getBranchName();

    await $`gh pr diff --repo ${owner}/${repo} ${branchName}`;
  },
  parameters: {},
  docs: {
    brief: "Show PR diff for current branch",
  },
});

type CommentsFlags = {
  json: boolean;
};

const comments = buildCommand({
  async func(this: CommandContext, flags: CommentsFlags) {
    const { owner, repo } = await getRepoInfo();
    const branchName = await getBranchName();

    const prComments = await getPrCommentsForBranch(owner, repo, branchName);

    if (flags.json) {
      console.log(prComments);
    } else {
      // Parse and format nicely
      const data = JSON.parse(prComments);
      const pr = data.data.repository.pullRequest;

      // Display general comments
      if (pr.comments.nodes.length > 0) {
        console.log("💬 General Comments:\n");
        for (const comment of pr.comments.nodes) {
          console.log(
            `  @${comment.author.login} (${new Date(comment.createdAt).toLocaleString()}):`,
          );
          console.log(`  ${comment.body}\n`);
        }
      }

      // Display review threads
      if (pr.reviewThreads.nodes.length > 0) {
        console.log("🧵 Review Threads:\n");
        for (const thread of pr.reviewThreads.nodes) {
          const status = thread.isResolved ? "✅ Resolved" : "⏳ Unresolved";
          const outdated = thread.isOutdated ? " (outdated)" : "";
          console.log(`  ${status}${outdated}`);

          for (const comment of thread.comments.nodes) {
            if (comment.isMinimized) continue;

            const location = comment.path
              ? ` [${comment.path}:${comment.line}]`
              : "";
            console.log(
              `    @${comment.author.login}${location} (${new Date(comment.createdAt).toLocaleString()}):`,
            );
            console.log(`    ${comment.body}\n`);
          }
        }
      }

      if (
        pr.comments.nodes.length === 0 &&
        pr.reviewThreads.nodes.length === 0
      ) {
        console.log("No comments found on this PR.");
      }
    }
  },
  parameters: {
    flags: {
      json: {
        kind: "boolean",
        brief: "Output raw JSON",
        default: false,
      },
    },
  },
  docs: {
    brief: "Show PR comments for current branch",
  },
});

const root = buildRouteMap({
  routes: {
    description,
    diff,
    comments,
  },
  docs: {
    brief: "GitHub PR information commands",
  },
});

const app = buildApplication(root, {
  name: "pr-info",
});

await runApp(app, process.argv.slice(2), { process });
