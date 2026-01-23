import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { $ } from "bun";
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { prInfoCommands } from "./pr-info";
import { linearCommands } from "./linear-tools";
import { randomUUID } from "node:crypto";

const dockerfile = (terminfo: string) => `
FROM debian:bookworm-slim

ARG TZ
ENV TZ="$TZ"

# System tools
RUN apt-get update && apt-get install -y --no-install-recommends \\
  ca-certificates curl less git ripgrep jq fd-find unzip \\
  ncurses-term ncurses-bin locales \\
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen \\
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Ghostty terminfo (for proper keyboard sequences)
RUN cat <<'TERMINFO' > /tmp/ghostty.terminfo && tic -x /tmp/ghostty.terminfo && rm /tmp/ghostty.terminfo
${terminfo}TERMINFO

# Locale environment
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Create agentbox user
RUN groupadd -r agentbox && useradd -r -g agentbox agentbox
RUN mkdir -p /workspace /home/agentbox /home/agentbox-template && \\
  chown -R agentbox:agentbox /workspace /home/agentbox /home/agentbox-template

# Entrypoint to preserve $HOME content
RUN printf '#!/bin/bash\\nif [ -z "$(ls -A /home/agentbox 2>/dev/null)" ]; then\\n  cp -a /home/agentbox-template/. /home/agentbox/\\nfi\\nexec "$@"\\n' > /entrypoint.sh && \\
  chmod +x /entrypoint.sh

# Install mise and claude as agentbox user
USER agentbox
ENV HOME=/home/agentbox-template
RUN curl https://mise.run | sh
RUN echo 'eval "$(~/.local/bin/mise activate --shims bash)"' >> ~/.bashrc
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN ~/.local/bin/mise use -g bun@latest
RUN ~/.local/bin/mise use -g node@22.14.0
RUN ~/.local/bin/mise use -g pnpm@10.27.0


ENV HOME=/home/agentbox
ENV PATH="/home/agentbox/.local/share/mise/shims:/home/agentbox/.local/bin:$PATH"
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
`;

type RunArgs = readonly string[];

const SAFETOOLS_PORT = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;

// Create MCP server
const mcpServer = new McpServer({
  name: "safetools",
  version: "1.0.0",
});

// Register all tools
for (const cmd of [...prInfoCommands, ...linearCommands]) {
  mcpServer.registerTool(
    cmd.mcpTool.name,
    cmd.mcpTool.config,
    cmd.mcpTool.handler,
  );
}

// Session management
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

async function updateMcpConfig() {
  const cwd = process.cwd();
  const mcpConfigPath = `${cwd}/.mcp.json`;
  const safetoolsConfig = {
    type: "http",
    url: `http://localhost:${SAFETOOLS_PORT}/mcp`,
  };

  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
  const mcpFile = Bun.file(mcpConfigPath);
  if (await mcpFile.exists()) {
    mcpConfig = await mcpFile.json();
    mcpConfig.mcpServers ??= {};
  }
  mcpConfig.mcpServers.safetools = safetoolsConfig;
  await Bun.write(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
}

function startMcpServer() {
  return Bun.serve({
    port: SAFETOOLS_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp") {
        return new Response("Not found", { status: 404 });
      }

      if (req.method === "POST") {
        const sessionId = req.headers.get("mcp-session-id") || randomUUID();
        let transport = sessions.get(sessionId);

        if (!transport) {
          transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
          });
          sessions.set(sessionId, transport);
          await mcpServer.connect(transport);
        }

        return transport.handleRequest(req);
      }

      return new Response("Method not allowed", { status: 405 });
    },
  });
}

type BuildFlags = {
  "no-cache": boolean;
};

const build = buildCommand<BuildFlags, [], CommandContext>({
  async func(this: CommandContext, flags: BuildFlags) {
    const cwd = process.cwd();

    // Generate fresh terminfo from current Ghostty installation
    const terminfo = await $`infocmp -x xterm-ghostty`.text();
    const dockerfileContent = dockerfile(terminfo);

    // Build using stdin dockerfile
    if (flags["no-cache"]) {
      await $`echo ${dockerfileContent} | docker build --no-cache -t agentbox:latest -f - ${cwd}`;
    } else {
      await $`echo ${dockerfileContent} | docker build -t agentbox:latest -f - ${cwd}`;
    }
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

const runCommand = buildCommand<{}, RunArgs, CommandContext>({
  async func(this: CommandContext, _flags, ...args: string[]) {
    const cwd = process.cwd();
    const command = args.length > 0 ? args[0] : "/bin/bash";
    const commandArgs = args.slice(1);

    await updateMcpConfig();
    const server = startMcpServer();

    try {
      await $`docker run --rm -it --network=host -e TERM=xterm-ghostty -v ~/.local/share/agentbox/home:/home/agentbox -v ${cwd}:/workspace -w /workspace agentbox:latest ${command} ${commandArgs}`;
    } finally {
      server.stop();
    }
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

const serverCommand = buildCommand<{}, [], CommandContext>({
  async func(this: CommandContext) {
    await updateMcpConfig();
    const server = startMcpServer();

    console.log(`MCP server running on http://localhost:${SAFETOOLS_PORT}/mcp`);
    console.log("Press Ctrl+C to stop");

    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        server.stop();
        resolve();
      });
      process.on("SIGTERM", () => {
        server.stop();
        resolve();
      });
    });
  },
  parameters: {},
  docs: {
    brief: "run only the MCP server without starting a container",
  },
});

const routes = buildRouteMap({
  routes: {
    build,
    run: runCommand,
    server: serverCommand,
  },
  docs: {
    brief: "agentbox - run commands in a sandboxed container with MCP tools",
  },
});

const app = buildApplication(routes, {
  name: "agentbox",
  scanner: {
    allowArgumentEscapeSequence: true,
  },
});

await runApp(app, process.argv.slice(2), { process });
