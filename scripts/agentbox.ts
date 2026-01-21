import {
  buildApplication,
  buildCommand,
  type CommandContext,
  run as runApp,
} from "@stricli/core";
import { $ } from "bun";
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { prInfoCommands } from "./pr-info";
import { randomUUID } from "node:crypto";

type RunArgs = readonly string[];

const SAFETOOLS_PORT = Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;

// Create MCP server
const mcpServer = new McpServer({
  name: "safetools",
  version: "1.0.0",
});

// Register all tools
for (const cmd of prInfoCommands) {
  mcpServer.registerTool(
    cmd.mcpTool.name,
    cmd.mcpTool.config,
    cmd.mcpTool.handler,
  );
}

// Session management
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

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

await runApp(app, process.argv.slice(2), { process });
server.stop();
