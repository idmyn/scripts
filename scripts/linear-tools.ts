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
import { defineRemoteCommand } from "$lib/remoteCommand";

const issueSchema = z.object({
  issue: z.string().describe("Linear issue ID (e.g., 'ABC-123')"),
});

const viewIssue = defineRemoteCommand({
  name: "get_linear_issue",
  schema: issueSchema,
  server: async (args) => {
    const output = await $`linear issue view ${args.issue}`
      .nothrow()
      .quiet();

    if (output.exitCode !== 0) {
      const stderr = output.stderr.toString().trim();
      if (stderr.includes("command not found")) {
        throw new Error(
          "Linear CLI is not installed. Install from: https://github.com/schpet/linear-cli"
        );
      }
      throw new Error(stderr || "Failed to retrieve Linear issue");
    }

    return output.stdout.toString();
  },
  client: (sendCommand) =>
    buildCommand({
      async func(this: CommandContext, flags: { issue: string }) {
        const result = await sendCommand({ issue: flags.issue });
        console.log(result);
      },
      parameters: {
        flags: {
          issue: {
            kind: "parsed",
            parse: String,
            brief: "Linear issue ID (e.g., 'ABC-123')",
          },
        },
      },
      docs: {
        brief: "Get Linear issue details by ID",
      },
    }),
});

export const linearCommands = [viewIssue];

export const linearRoutes = buildRouteMap({
  routes: {
    view: viewIssue.command,
  },
  docs: {
    brief: "Linear issue commands",
  },
});

if (import.meta.main) {
  const app = buildApplication(linearRoutes, {
    name: "linear-tools",
  });
  await runApp(app, process.argv.slice(2), { process });
}
