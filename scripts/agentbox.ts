import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { $ } from "bun";
import { homedir } from "os";
import { join } from "path";
import process from "node:process";

// adapted from https://github.com/anthropics/claude-code/blob/main/.devcontainer/Dockerfile
const DOCKERFILE = `
  FROM debian:bookworm-slim

  ARG TZ
  ENV TZ="$TZ"

  RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    less \
    git \
    ripgrep \
    jq \
    fd-find \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

  # Create the agentbox user and group
  RUN groupadd -r agentbox && useradd -r -g agentbox agentbox

  # Create workspace and directories, set permissions
  RUN mkdir -p /workspace /home/agentbox /home/agentbox-template && \
    chown -R agentbox:agentbox /workspace /home/agentbox /home/agentbox-template

  # Create entrypoint script to preserve $HOME content from image build phase into the running container (without this you lose the contents due to '-v' flags when running)
  RUN printf '#!/bin/bash\\nif [ -z "$(ls -A /home/agentbox 2>/dev/null)" ]; then\\n  cp -a /home/agentbox-template/. /home/agentbox/\\nfi\\nexec "$@"\\n' > /entrypoint.sh && \
    chmod +x /entrypoint.sh

  # Install everything to template directory
  USER agentbox
  ENV HOME=/home/agentbox-template

  RUN curl https://mise.run | sh
  RUN echo 'eval "$(~/.local/bin/mise activate --shims bash)"' >> ~/.bashrc

  # install claude code
  RUN curl -fsSL https://claude.ai/install.sh | bash

  ENV HOME=/home/agentbox
  ENV PATH="/home/agentbox/.local/bin:$PATH"

  ENTRYPOINT ["/entrypoint.sh"]
`;

type BuildFlags = {
  "no-cache": boolean;
};

const build = buildCommand({
  async func(this: CommandContext, flags: BuildFlags) {
    const noCacheFlag = flags["no-cache"] ? "--no-cache" : "";
    await $`docker build ${noCacheFlag} -t agentbox:latest - < ${new Response(DOCKERFILE)}`;
    await $`mkdir -p ~/.local/share/agentbox/home`;
  },
  parameters: {
    flags: {
      "no-cache": {
        kind: "boolean",
        withNegated: false,
        brief: "forwards --no-cache flag to docker build",
      },
    },
  },
  docs: {
    brief: "build docker image",
  },
});

type RunArgs = readonly string[];

const run = buildCommand<{}, RunArgs, CommandContext>({
  async func(this: CommandContext, _flags, ...args: string[]) {
    const cwd = process.cwd();
    const command = args.length > 0 ? args[0] : "/bin/bash";
    const commandArgs = args.slice(1);
    const safetoolsPath = join(homedir(), ".local", "bin", "safetools-linux");

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
    build,
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
