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

  await $`bun build --compile --no-compile-autoload-dotenv ${source} --outfile ${out}`;
  await $`chmod +x ${out} && ln -sf ${out} ${destination}`;
}
