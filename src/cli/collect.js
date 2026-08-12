import { parseArgs } from "./args.js";
import { loadLocations } from "../lib/locations.js";
import { collect } from "../lib/collector.js";
import { generateMarkdown } from "../lib/generator.js";
import { GitHubClient, MockGitHubClient } from "../lib/github.js";

const args = parseArgs(process.argv.slice(2));
const countries = await loadLocations();
const maxQueries = Number(args["max-queries"] ?? process.env.MAX_QUERIES ?? 120);
const dryRun = Boolean(args["dry-run"]);
const client = args.mock
  ? new MockGitHubClient()
  : new GitHubClient({ token: process.env.GITHUB_TOKEN });

const result = await collect({ countries, client, maxQueries, dryRun });
if (!dryRun) {
  await generateMarkdown({ countries });
}

console.log(JSON.stringify({
  dryRun,
  queries: result.queries,
  remainingTasks: result.remainingTasks
}, null, 2));
