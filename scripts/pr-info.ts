import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { z } from "zod";
import { $ } from "bun";
import process from "node:process";
import { getRepoInfo, getBranchName } from "$lib/vcs";
import { getPrCommentsForBranch } from "$lib/github";
import { defineRemoteCommand } from "$lib/remoteCommand";

const description = defineRemoteCommand({
  name: "pr-description",
  schema: z.undefined(),
  server: async () => {
    const { owner, repo } = await getRepoInfo();
    const branchName = await getBranchName();
    const output = await $`gh pr view --repo ${owner}/${repo} ${branchName}`
      .nothrow()
      .quiet();
    if (output.exitCode !== 0) throw new Error(output.stderr.toString());
    return output.stdout.toString();
  },
  client: (sendCommand) =>
    buildCommand({
      async func(this: CommandContext) {
        const result = await sendCommand(undefined);
        console.log(result);
      },
      parameters: {},
      docs: {
        brief: "Get PR description for current branch",
      },
    }),
});

const diff = defineRemoteCommand({
  name: "pr-diff",
  schema: z.undefined(),
  server: async () => {
    const { owner, repo } = await getRepoInfo();
    const branchName = await getBranchName();
    const output = await $`gh pr diff --repo ${owner}/${repo} ${branchName}`
      .nothrow()
      .quiet();
    if (output.exitCode !== 0) throw new Error(output.stderr.toString());
    return output.stdout.toString();
  },
  client: (sendCommand) =>
    buildCommand({
      async func(this: CommandContext) {
        const result = await sendCommand(undefined);
        console.log(result);
      },
      parameters: {},
      docs: {
        brief: "Get PR diff for current branch",
      },
    }),
});

const commentsSchema = z.object({ json: z.boolean() });

const comments = defineRemoteCommand({
  name: "pr-comments",
  schema: commentsSchema,
  server: async (flags) => {
    const { owner, repo } = await getRepoInfo();
    const branchName = await getBranchName();
    const rawComments = await getPrCommentsForBranch(owner, repo, branchName);

    if (flags.json) {
      return rawComments;
    }

    // Parse and format nicely
    const data = JSON.parse(rawComments);
    const pr = data.data.repository.pullRequest;
    const lines: string[] = [];

    // Display general comments
    if (pr.comments.nodes.length > 0) {
      lines.push("💬 General Comments:\n");
      for (const comment of pr.comments.nodes) {
        lines.push(
          `  @${comment.author.login} (${new Date(comment.createdAt).toLocaleString()}):`,
        );
        lines.push(`  ${comment.body}\n`);
      }
    }

    // Display review threads
    if (pr.reviewThreads.nodes.length > 0) {
      lines.push("🧵 Review Threads:\n");
      for (const thread of pr.reviewThreads.nodes) {
        const status = thread.isResolved ? "✅ Resolved" : "⏳ Unresolved";
        const outdated = thread.isOutdated ? " (outdated)" : "";
        lines.push(`  ${status}${outdated}`);

        for (const comment of thread.comments.nodes) {
          if (comment.isMinimized) continue;

          const location = comment.path
            ? ` [${comment.path}:${comment.line}]`
            : "";
          lines.push(
            `    @${comment.author.login}${location} (${new Date(comment.createdAt).toLocaleString()}):`,
          );
          lines.push(`    ${comment.body}\n`);
        }
      }
    }

    if (pr.comments.nodes.length === 0 && pr.reviewThreads.nodes.length === 0) {
      lines.push("No comments found on this PR.");
    }

    return lines.join("\n");
  },
  client: (sendCommand) =>
    buildCommand({
      async func(this: CommandContext, flags: { json: boolean }) {
        const result = await sendCommand({ json: flags.json });
        console.log(result);
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
        brief: "Get PR comments for current branch",
      },
    }),
});

export const prInfoCommands = [description, diff, comments];
export const prInfoRoutes = buildRouteMap({
  routes: {
    description: description.command,
    diff: diff.command,
    comments: comments.command,
  },
  docs: {
    brief: "GitHub PR information commands",
  },
});

if (import.meta.main) {
  const app = buildApplication(prInfoRoutes, {
    name: "pr-info",
  });
  await runApp(app, process.argv.slice(2), { process });
}
