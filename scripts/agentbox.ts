import {
  buildApplication,
  buildCommand,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { $ } from "bun";
import process from "node:process";
import { serverHandler } from "./safetools";

type RunArgs = readonly string[];

const SAFETOOLS_PORT = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;

const run = buildCommand<{}, RunArgs, CommandContext>({
  async func(this: CommandContext, _flags, ...args: string[]) {
    const cwd = process.cwd();
    const command = args.length > 0 ? args[0] : "/bin/bash";
    const commandArgs = args.slice(1);

    await $`docker run --rm -it --network=host -e SAFETOOLS_PORT=${SAFETOOLS_PORT} -v ~/.local/share/agentbox/home:/home/agentbox -v ${cwd}:/workspace -w /workspace agentbox:latest ${command} ${commandArgs}`;
  },
  parameters: {
    positional: {
      kind: "array",
      parameter: {
        brief: "Command and arguments to run in the container",
        parse: String,
        placeholder: "args",
      },
    },
  },
  docs: {
    brief:
      "run a command in agentbox container with current directory mounted to /workspace",
  },
});

const app = buildApplication(run, {
  name: "agentbox",
  scanner: {
    allowArgumentEscapeSequence: true,
  },
});

const server = Bun.serve({
  port: SAFETOOLS_PORT,
  fetch: serverHandler,
});
await runApp(app, process.argv.slice(2), { process });
server.stop();
