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
import { buildServer } from "$lib/remoteCommand";
import { prInfoCommands, prInfoRoutes } from "./pr-info";

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

export const serverHandler = buildServer([...prInfoCommands]);

if (import.meta.main) {
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
