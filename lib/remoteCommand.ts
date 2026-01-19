import { z, ZodType } from "zod";
import { buildCommand } from "@stricli/core";

const PORT = process.env.SAFETOOLS_PORT;
const SHOULD_RUN_LOCALLY = !PORT;

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
  const res = await fetch(`http://localhost:${PORT}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  return (await res.json()) as ServerResponse;
}

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

export const logResult = (response: ServerResponse) => {
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

export const buildServer = (remoteCommands: RemoteCommand[]) => {
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

      // Validate command exists
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
