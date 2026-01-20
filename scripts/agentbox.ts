import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { $ } from "bun";
import process from "node:process";

type RunArgs = readonly string[];

const run = buildCommand<{}, RunArgs, CommandContext>({
  async func(this: CommandContext, _flags, ...args: string[]) {
    const cwd = process.cwd();
    const command = args.length > 0 ? args[0] : "/bin/bash";
    const commandArgs = args.slice(1);

    await $`docker run --rm -it --network=host -v ~/.local/share/agentbox/home:/home/agentbox -v ${cwd}:/workspace -v ${safetoolsPath}:/usr/local/bin/safetools:ro -w /workspace agentbox:latest ${command} ${commandArgs}`;
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

const root = buildRouteMap({
  routes: {
    run,
  },
  docs: {
    brief: "All available commands",
  },
});

const app = buildApplication(root, {
  name: "agentbox",
  scanner: {
    allowArgumentEscapeSequence: true,
  },
});

await runApp(app, process.argv.slice(2), { process });
