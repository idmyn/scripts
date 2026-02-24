import { $ } from "bun";
import { join } from "path";
import { homedir } from "os";
import { readdir } from "fs/promises";

const projectDir = import.meta.dir;
const scriptsDir = join(projectDir, "scripts");

const files = await readdir(scriptsDir);
const scripts = files
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""));

await $`rm -rf dist && mkdir dist`;

for (const script of scripts) {
  const source = join(scriptsDir, `${script}.ts`);
  const out = join(projectDir, "dist", script);
  const destination = join(homedir(), ".local", "bin", script);

  const defines: string[] = [];
  if (script === "maps" && process.env.GOOGLE_MAPS_API_KEY) {
    defines.push(`--define`, `process.env.GOOGLE_MAPS_API_KEY=${JSON.stringify(process.env.GOOGLE_MAPS_API_KEY)}`);
  }

  await $`bun build --compile --no-compile-autoload-dotenv ${defines} ${source} --outfile ${out}`;
  await $`chmod +x ${out} && ln -sf ${out} ${destination}`;
}
