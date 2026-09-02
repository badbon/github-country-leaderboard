import { escapeMarkdown } from "./text.js";
import { sortForCategory, valueForCategory } from "./ranking.js";

export const CATEGORY_META = {
  publicContributions: {
    title: "Public Contributions",
    metric: "Public Contributions",
    folder: "public_contributions"
  },
  totalContributions: {
    title: "Total Contributions",
    metric: "Total Contributions",
    folder: "total_contributions"
  },
  followers: {
    title: "Followers",
    metric: "Followers",
    folder: "followers"
  }
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_META);
const COUNTRY_HUB_CATEGORY_KEYS = ["totalContributions", "publicContributions", "followers"];

export function renderLeaderboard({ country, users, category, generatedAt }) {
  const meta = CATEGORY_META[category];
  const value = valueForCategory(category);
  const rows = sortForCategory(users, category).slice(0, 20);
  const lines = [
    `# ${meta.title} - ${country.name}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    `Users: ${users.length}`,
    "",
    "| # | User | Name | Company | Twitter | Location | " + meta.metric + " |",
    "|---:|---|---|---|---|---|---:|"
  ];

  rows.forEach((user, index) => {
    lines.push(
      `| ${index + 1} | [${escapeMarkdown(user.login)}](https://github.com/${encodeURIComponent(user.login)}) | ${escapeMarkdown(user.name)} | ${escapeMarkdown(user.company)} | ${escapeMarkdown(user.twitterUsername)} | ${escapeMarkdown(user.location)} | ${value(user)} |`
    );
  });

  lines.push("");
  return lines.join("\n");
}

export function renderReadme({ countries, generatedAt }) {
  const dailyCountries = pickDailyCountries(countries, generatedAt, 5);
  const lines = [
    "# GitHub Country Leaderboard",
    "",
    "Top GitHub users by country, ranked from public GitHub profile and contribution data.",
    "",
    "## Browse",
    "",
    "- [All countries](markdown/README.md)",
    "- [Public contributions](markdown/public_contributions/README.md)",
    "- [Total contributions](markdown/total_contributions/README.md)",
    "- [Followers](markdown/followers/README.md)",
    "- [Index status](markdown/status.md)",
    "",
    "## Random Countries (Daily Featured)",
    "",
    "| Country | Indexed Users | Public | Total | Followers |",
    "|---|---:|---|---|---|",
    ...dailyCountries.map((country) => renderCountryLinkRow(country, "markdown/")),
    "",
    "## How It Works",
    "",
    "The collector searches GitHub users by self-reported profile location, keeps users with at least one follower, computes rolling contribution counts, and publishes leaderboards only after a country baseline is complete.",
    "",
    "Locations are not verified. The raw profile location is preserved, and country assignment uses deterministic country, alias, city, and exact phrase rules.",
    "",
    `Generated: ${generatedAt}`,
    ""
  ];

  return lines.join("\n");
}

export function renderMainIndex({ countries, generatedAt }) {
  return [
    "# Countries",
    "",
    `Published countries: ${countries.length}`,
    "",
    "| Country | Indexed Users | Public | Total | Followers |",
    "|---|---:|---|---|---|",
    ...countries.map((country) => renderCountryLinkRow(country, "")),
    "",
    `Generated: ${generatedAt}`,
    ""
  ].join("\n");
}

export function renderStatus({ countries, state, generatedAt }) {
  const statusCounts = {};
  for (const countryState of Object.values(state?.countries ?? {})) {
    statusCounts[countryState.status] = (statusCounts[countryState.status] ?? 0) + 1;
  }

  const remaining = countries
    .filter((country) => !isPublished(state, country.slug))
    .map((country) => {
      const entry = state?.countries?.[country.slug] ?? {};
      return {
        name: country.name,
        status: entry.status ?? "pending",
        queued: entry.queue?.length ?? 0
      };
    })
    .sort((a, b) => b.queued - a.queued || a.name.localeCompare(b.name));

  const lines = [
    "# Index Status",
    "",
    `Generated: ${generatedAt}`,
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Countries configured | ${countries.length} |`,
    `| Countries published | ${countries.filter((country) => isPublished(state, country.slug)).length} |`,
    `| Users indexed | ${formatNumber(state?.stats?.usersKept ?? 0)} |`,
    `| Discovery shards queued | ${formatNumber(totalQueued(state))} |`,
    "",
    "## Country Status",
    "",
    "| Status | Countries |",
    "|---|---:|",
    ...Object.entries(statusCounts).sort().map(([status, count]) => `| ${escapeMarkdown(status)} | ${count} |`),
    "",
    "## Remaining Discovery",
    "",
    "| Country | Status | Queued Shards |",
    "|---|---|---:|",
    ...remaining.slice(0, 50).map((country) => `| ${escapeMarkdown(country.name)} | ${escapeMarkdown(country.status)} | ${country.queued} |`),
    ""
  ];

  return lines.join("\n");
}

export function renderCategoryIndex({ countries, category, generatedAt }) {
  const meta = CATEGORY_META[category];
  return [
    `# ${meta.title}`,
    "",
    `Published countries: ${countries.length}`,
    "",
    "| Country | Indexed Users | Leaderboard |",
    "|---|---:|---|",
    ...countries.map((country) => `| ${escapeMarkdown(country.name)} | ${formatNumber(country.userCount ?? 0)} | [View](./${country.slug}.md) |`),
    "",
    `Generated: ${generatedAt}`,
    ""
  ].join("\n");
}

export function renderCountryHub({ country, users, generatedAt }) {
  const lines = [
    `# ${country.name}`,
    "",
    `Indexed users: ${formatNumber(users.length)}`,
    "",
    "| Leaderboard | Link |",
    "|---|---|",
    `| Total Contributions | [Open](../total_contributions/${country.slug}.md) |`,
    `| Public Contributions | [Open](../public_contributions/${country.slug}.md) |`,
    `| Followers | [Open](../followers/${country.slug}.md) |`,
    ""
  ];

  for (const category of COUNTRY_HUB_CATEGORY_KEYS) {
    const meta = CATEGORY_META[category];
    lines.push(`## ${meta.title}`, "");
    lines.push(...renderCompactLeaderboardRows({ users, category }));
    lines.push("");
  }

  lines.push(`Generated: ${generatedAt}`, "");
  return lines.join("\n");
}

function renderCompactLeaderboardRows({ users, category }) {
  const meta = CATEGORY_META[category];
  const value = valueForCategory(category);
  const rows = sortForCategory(users, category).slice(0, 20);
  return [
    `| # | User | Name | Location | ${meta.metric} |`,
    "|---:|---|---|---|---:|",
    ...rows.map((user, index) => `| ${index + 1} | [${escapeMarkdown(user.login)}](https://github.com/${encodeURIComponent(user.login)}) | ${escapeMarkdown(user.name)} | ${escapeMarkdown(user.location)} | ${formatNumber(value(user))} |`)
  ];
}

function renderCountryLinkRow(country, basePath) {
  return `| [${escapeMarkdown(country.name)}](${basePath}countries/${country.slug}.md) | ${formatNumber(country.userCount ?? 0)} | [Public](${basePath}public_contributions/${country.slug}.md) | [Total](${basePath}total_contributions/${country.slug}.md) | [Followers](${basePath}followers/${country.slug}.md) |`;
}

function pickDailyCountries(countries, generatedAt, count) {
  const seed = String(generatedAt).slice(0, 10);
  return [...countries]
    .map((country) => ({ country, key: hash(`${seed}:${country.slug}`) }))
    .sort((a, b) => a.key - b.key || a.country.name.localeCompare(b.country.name))
    .slice(0, count)
    .map(({ country }) => country);
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isPublished(state, slug) {
  const status = state?.countries?.[slug]?.status;
  return state?.version === 3 && (status === "complete" || status === "refreshing");
}

function totalQueued(state) {
  return Object.values(state?.countries ?? {}).reduce((sum, country) => sum + (country.queue?.length ?? 0), 0);
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}
