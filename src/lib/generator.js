import { CACHE_DIR, MARKDOWN_DIRS, STATE_PATH } from "./paths.js";
import { readJson, removeFile, writeJson, writeText } from "./storage.js";
import { renderLeaderboard } from "./render.js";
import { classifyLocation } from "./classifier.js";
import { dedupeUsers } from "./ranking.js";

export async function generateMarkdown({ countries, generatedAt = new Date().toISOString(), state = null }) {
  const effectiveState = state ?? await readJson(STATE_PATH, null);
  const caches = await normalizeCaches(countries);
  for (const country of countries) {
    const paths = markdownPaths(country.slug);
    if (!isComplete(effectiveState, country.slug)) {
      await removeFile(paths.publicContributions);
      await removeFile(paths.totalContributions);
      await removeFile(paths.followers);
      continue;
    }

    const users = caches[country.slug] ?? [];
    await writeText(paths.publicContributions, renderLeaderboard({ country, users, category: "publicContributions", generatedAt }));
    await writeText(paths.totalContributions, renderLeaderboard({ country, users, category: "totalContributions", generatedAt }));
    await writeText(paths.followers, renderLeaderboard({ country, users, category: "followers", generatedAt }));
  }
}

function isComplete(state, slug) {
  return state?.version === 3 && state.countries?.[slug]?.status === "complete";
}

function markdownPaths(slug) {
  return {
    publicContributions: `${MARKDOWN_DIRS.publicContributions}/${slug}.md`,
    totalContributions: `${MARKDOWN_DIRS.totalContributions}/${slug}.md`,
    followers: `${MARKDOWN_DIRS.followers}/${slug}.md`
  };
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
