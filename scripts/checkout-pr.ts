import { $ } from "bun";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { getRepoInfo } from "$lib/vcs";

const fetchPromise = $`jj git fetch`.quiet();

const PR = z.object({
  author: z.union([
    z.object({
      name: z.string(),
      login: z.string(),
      is_bot: z.literal(false),
    }),
    z.object({
      is_bot: z.literal(true),
    }),
  ]),
  title: z.string(),
  updatedAt: z.coerce.date(),
  headRefOid: z.string(),
});

const now = Temporal.Now.instant();
const today = Temporal.Now.plainDateISO();
const lastWeek = today.subtract({ weeks: 3 }).toString();

const updatedAtFilter = `updated:>${lastWeek}`;

const { repoArg } = await getRepoInfo();

const prs = PR.array().parse(
  JSON.parse(
    await $`gh pr list ${repoArg} --search=${updatedAtFilter} --json="author,title,updatedAt,headRefOid"`.text(),
  ),
);

// First collect the entries so we can calculate the max width of the first column
interface Entry {
  authorWhen: string;
  title: string;
  commit: string;
}

const entries: Entry[] = prs.flatMap((pr) => {
  if (pr.author.is_bot) {
    return [];
  }

  const updatedAt = Temporal.Instant.from(pr.updatedAt.toISOString());
  const duration = updatedAt.until(now);
  const daysAgo = Math.floor(duration.total({ unit: "days" }));
  const when = daysAgo === 0 ? "today" : `${daysAgo} days ago`;
  const author = pr.author.name || pr.author.login;

  return [
    {
      authorWhen: `${author} (${when})`,
      title: pr.title,
      commit: pr.headRefOid,
    },
  ];
});

// Determine the width for the first column so that all rows line up
const maxAuthorWhenLen = entries.reduce(
  (max, { authorWhen }) => Math.max(max, authorWhen.length),
  0,
);

// Build the list: "<padded authorWhen>  <title>\t<branch>"
const list = entries
  .map(({ authorWhen, title, commit }) => {
    const paddedAuthorWhen = authorWhen.padEnd(maxAuthorWhenLen + 2); // +2 for spacing between columns
    return `${paddedAuthorWhen}${title}\t${commit}`;
  })
  .join("\n");

// Pipe the list into fzf. We hide the branch column while keeping it in the
// line so we can recover it after selection.
const selectedLine = (
  await $`fzf --ansi --delimiter="\t" --with-nth=1 < ${new Response(list)}`
    .nothrow()
    .text()
).trim();

if (selectedLine.length === 0) {
  console.error("no PR selected");
  process.exit(1);
}

// Extract the commit (hidden second column)
const [, commit] = selectedLine.split("\t");

await fetchPromise;
await $`jj new ${commit}`.quiet();
