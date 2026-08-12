import { CACHE_DIR, MARKDOWN_DIRS } from "./paths.js";
import { readJson, writeJson, writeText } from "./storage.js";
import { renderLeaderboard } from "./render.js";
import { classifyLocation } from "./classifier.js";
import { dedupeUsers } from "./ranking.js";

export async function generateMarkdown({ countries, generatedAt = new Date().toISOString() }) {
  const caches = await normalizeCaches(countries);
  for (const country of countries) {
    const users = caches[country.slug] ?? [];
    await writeText(
      `${MARKDOWN_DIRS.publicContributions}/${country.slug}.md`,
      renderLeaderboard({ country, users, category: "publicContributions", generatedAt })
    );
    await writeText(
      `${MARKDOWN_DIRS.totalContributions}/${country.slug}.md`,
      renderLeaderboard({ country, users, category: "totalContributions", generatedAt })
    );
    await writeText(
      `${MARKDOWN_DIRS.followers}/${country.slug}.md`,
      renderLeaderboard({ country, users, category: "followers", generatedAt })
    );
  }
}

async function normalizeCaches(countries) {
  const users = [];
  for (const country of countries) {
    users.push(...(await readJson(`${CACHE_DIR}/${country.slug}.json`, [])));
  }

  const caches = Object.fromEntries(countries.map((country) => [country.slug, []]));
  for (const user of dedupeUsers(users)) {
    const slug = classifyLocation(user.location, countries);
    if (slug) caches[slug].push(user);
  }

  for (const country of countries) {
    caches[country.slug] = dedupeUsers(caches[country.slug]);
    await writeJson(`${CACHE_DIR}/${country.slug}.json`, caches[country.slug]);
  }

  return caches;
}
