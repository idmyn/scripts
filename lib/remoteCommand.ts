import { z, ZodType } from "zod";
import { buildCommand } from "@stricli/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Extract raw shape from a Zod object schema, or return undefined for non-object schemas
function getInputSchemaForMcp<TSchema extends ZodType>(
  schema: TSchema,
): Record<string, ZodType> | undefined {
  if (schema instanceof z.ZodObject) {
    return schema.shape as Record<string, ZodType>;
  }
  return undefined;
}

export type McpToolConfig = {
  name: string;
  config: {
    description: string;
    inputSchema: Record<string, ZodType> | undefined;
  };
  handler: (...args: unknown[]) => Promise<CallToolResult>;
};

export function defineRemoteCommand<TSchema extends ZodType>({
  name,
  schema,
  server,
  client,
}: {
  name: string;
  schema: TSchema;
  server: (args: z.infer<TSchema>) => string | Promise<string>;
  client: (
    sendCommand: (args: z.infer<TSchema>) => Promise<string>,
  ) => ReturnType<typeof buildCommand>;
}): {
  name: string;
  command: ReturnType<typeof buildCommand>;
  mcpTool: McpToolConfig;
} {
  // sendCommand now just calls server directly (no HTTP, no ServerResponse wrapper)
  const sendCommand = async (args: z.infer<TSchema>): Promise<string> => {
    return server(schema.parse(args));
  };

  const command = client(sendCommand);

  // MCP tool config - use raw shape for object schemas, undefined otherwise
  const inputSchema = getInputSchemaForMcp(schema);

  // Create handler with correct signature based on whether we have input or not
  // MCP SDK expects (extra) => ... for no-arg tools, (args, extra) => ... for tools with args
  const handler = async (
    ...handlerArgs: unknown[]
  ): Promise<CallToolResult> => {
    // When inputSchema is undefined, handlerArgs[0] is extra
    // When inputSchema is defined, handlerArgs[0] is args and handlerArgs[1] is extra
    const args = inputSchema ? (handlerArgs[0] as z.infer<TSchema>) : undefined;
    const result = await server(schema.parse(args));
    return { content: [{ type: "text" as const, text: result }] };
  };

  const mcpTool: McpToolConfig = {
    name,
    config: {
      description: command.brief,
      inputSchema,
    },
    handler,
  };

  return { name, command, mcpTool };
}
