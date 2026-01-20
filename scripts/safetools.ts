#!/usr/bin/env bun
import { buildApplication, buildRouteMap, run as runApp } from "@stricli/core";
import process from "node:process";
import { buildServer } from "$lib/remoteCommand";
import { prInfoRoutes, prInfoCommands } from "./pr-info";

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

  // Keep server running
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
