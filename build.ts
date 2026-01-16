import { $ } from "bun";
import { join } from "path";
import { homedir } from "os";

const scripts = ["checkout-pr", "pr-info"];
const projectDir = import.meta.dir;

await $`rm -rf dist && mkdir dist`;

for (const script of scripts) {
  const source = join(projectDir, `${script}.ts`);
  const out = join(projectDir, "dist", script);
  const destination = join(homedir(), ".local", "bin", script);

  await $`bun build --compile --no-compile-autoload-dotenv ${source} --outfile ${out}`;
  await $`chmod +x ${out} && ln -sf ${out} ${destination}`;
}
