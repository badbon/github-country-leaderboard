import { escapeMarkdown } from "./text.js";
import { sortForCategory, valueForCategory } from "./ranking.js";

const CATEGORY_META = {
  publicContributions: {
    title: "Public Contributions",
    metric: "Public Contributions"
  },
  totalContributions: {
    title: "Total Contributions",
    metric: "Total Contributions"
  },
  followers: {
    title: "Followers",
    metric: "Followers"
  }
};

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
