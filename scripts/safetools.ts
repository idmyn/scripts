#!/usr/bin/env bun
import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  run as runApp,
  type CommandContext,
} from "@stricli/core";
import { z, ZodType } from "zod";
import { $ } from "bun";
import process from "node:process";

// ============================================================================
// remoteCommand
// ============================================================================

const SAFETOOLS_PORT = process.env.SAFETOOLS_PORT;
const SHOULD_RUN_LOCALLY = !SAFETOOLS_PORT;

type ServerResponse =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "ok";
      result: unknown;
    };

async function sendCommand(
  command: string,
  args: unknown,
): Promise<ServerResponse> {
  const message = { command, args };
  const res = await fetch(`http://localhost:${SAFETOOLS_PORT}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  return (await res.json()) as ServerResponse;
}

function defineRemoteCommand<TSchema extends ZodType>({
  name,
  schema,
  server,
  client,
}: {
  name: string;
  schema: TSchema;
  server: (args: z.infer<TSchema>) => string | Promise<string>;
  client: (
    sendCommand: (args: z.infer<TSchema>) => Promise<ServerResponse>,
  ) => ReturnType<typeof buildCommand>;
}) {
  const serverFn = async (args: unknown): Promise<ServerResponse> => {
    try {
      const result = await server(schema.parse(args));
      return {
        status: "ok",
        result,
      };
    } catch (err) {
      return {
        status: "error",
        message: `Command execution failed. ${err}`,
      };
    }
  };
  const command = client((args) => {
    if (SHOULD_RUN_LOCALLY) {
      return serverFn(args);
    }
    return sendCommand(name, args);
  });
  return { name, command, serverFn };
}

const logResult = (response: ServerResponse) => {
  if (response.status === "ok") {
    console.log(response.result);
  } else {
    console.error(response.message);
  }
};

type RemoteCommand = {
  name: string;
  serverFn: (args: unknown) => Promise<ServerResponse>;
};

const buildServer = (remoteCommands: RemoteCommand[]) => {
  const serverCommandRegistry = remoteCommands.reduce<
    Record<string, RemoteCommand["serverFn"]>
  >((acc, cur) => {
    acc[cur.name] = cur.serverFn;
    return acc;
  }, {});

  return async (req: Request) => {
    if (req.method !== "POST") {
      return Response.json(
        {
          status: "error",
          message: "Method not allowed",
        } satisfies ServerResponse,
        { status: 405 },
      );
    }

    try {
      const message = z
        .object({ command: z.string(), args: z.unknown() })
        .parse(await req.json());

      console.log(`Received: ${JSON.stringify(message)}`);

      const serverFn = serverCommandRegistry[message.command];

      if (!serverFn) {
        return Response.json(
          {
            status: "error",
            message: `Unknown command: ${message.command}`,
          } satisfies ServerResponse,
          { status: 400 },
        );
      }

      const response = await serverFn(message.args);

      return Response.json(response);
    } catch (err) {
      return Response.json(
        {
          status: "error",
          message: `Invalid JSON: ${err}`,
        } satisfies ServerResponse,
        { status: 400 },
      );
    }
  };
};

// ============================================================================
// vcs
// ============================================================================

async function getBranchName(): Promise<string> {
  const isJjRepo = await $`jj root`
    .nothrow()
    .quiet()
    .then((r) => r.exitCode === 0);

  if (isJjRepo) {
    const bookmarkName = (
      await $`jj bookmark list -r "closest_bookmark(@)" -T "json(self)" | jq -r '.name'`.text()
    ).trim();
    return bookmarkName;
  }

  const isGitRepo = await $`git rev-parse --git-dir`
    .nothrow()
    .quiet()
    .then((r) => r.exitCode === 0);

  if (isGitRepo) {
    const branchName = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
    return branchName;
  }

  console.error("Error: Not in a git or jj repository");
  process.exit(1);
}

async function getRepoInfo(): Promise<{
  repoArg: string;
  owner: string;
  repo: string;
}> {
  const isGitRepo = await $`git rev-parse --git-dir`
    .nothrow()
    .quiet()
    .then((r) => r.exitCode === 0);

  let repoIdentifier: string;

  if (isGitRepo) {
    try {
      repoIdentifier = (
        await $`gh repo view --json nameWithOwner --jq '.nameWithOwner'`.text()
      ).trim();
    } catch (error) {
      console.error(
        "Error: Could not get repository information from GitHub. Make sure you have a remote configured.",
      );
      process.exit(1);
    }
  } else {
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

// ============================================================================
// github
// ============================================================================

async function getPrComments(
  prNumber: string,
  owner: string,
  repo: string,
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

async function getPrCommentsForBranch(
  owner: string,
  repo: string,
  branchName: string,
): Promise<string> {
  const prNumber = (
    await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number --jq '.[0].number'`.text()
  ).trim();

  if (!prNumber) {
    throw new Error(`No PR found for branch: ${branchName}`);
  }

  return getPrComments(prNumber, owner, repo);
}

// ============================================================================
// pr-info commands
// ============================================================================

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
        logResult(result);
      },
      parameters: {},
      docs: {
        brief: "Show PR description for current branch",
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
        logResult(result);
      },
      parameters: {},
      docs: {
        brief: "Show PR diff for current branch",
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

    const data = JSON.parse(rawComments);
    const pr = data.data.repository.pullRequest;
    const lines: string[] = [];

    if (pr.comments.nodes.length > 0) {
      lines.push("💬 General Comments:\n");
      for (const comment of pr.comments.nodes) {
        lines.push(
          `  @${comment.author.login} (${new Date(comment.createdAt).toLocaleString()}):`,
        );
        lines.push(`  ${comment.body}\n`);
      }
    }

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
        logResult(result);
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
    }),
});

const prInfoCommands = [description, diff, comments];
const prInfoRoutes = buildRouteMap({
  routes: {
    description: description.command,
    diff: diff.command,
    comments: comments.command,
  },
  docs: {
    brief: "GitHub PR information commands",
  },
});

export const serverHandler = buildServer([...prInfoCommands]);

// ============================================================================
// main
// ============================================================================

const MODE = process.env.MODE;
const PORT = process.env.PORT;

if (MODE === "server" && !PORT) {
  console.error(
    "You need to provide a PORT env variable to run safetools in server mode",
  );
  process.exit(1);
}

if (MODE === "server") {
  console.log(`Server listening on port ${PORT}`);

  Bun.serve({
    port: PORT,
    fetch: buildServer([...prInfoCommands]),
  });

  await new Promise(() => {});
} else {
  const root = buildRouteMap({
    routes: {
      "pr-info": prInfoRoutes,
    },
    docs: {
      brief: "a collection of tools",
    },
  });

  const app = buildApplication(root, {
    name: "safetools",
  });

  await runApp(app, process.argv.slice(2), { process });
}
