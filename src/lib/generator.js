import { CACHE_DIR, MARKDOWN_DIRS, README_PATH, STATE_PATH } from "./paths.js";
import { readJson, removeFile, writeJson, writeText } from "./storage.js";
import {
  CATEGORY_KEYS,
  renderCategoryIndex,
  renderCountryHub,
  renderLeaderboard,
  renderMainIndex,
  renderReadme,
  renderStatus
} from "./render.js";
import { classifyLocation } from "./classifier.js";
import { dedupeUsers } from "./ranking.js";

export async function generateMarkdown({ countries, generatedAt = new Date().toISOString(), state = null }) {
  const effectiveState = state ?? await readJson(STATE_PATH, null);
  const caches = await normalizeCaches(countries);
  const publishedCountries = [];

  for (const country of countries) {
    const paths = markdownPaths(country.slug);
    if (!isComplete(effectiveState, country.slug)) {
      await removeFile(paths.publicContributions);
      await removeFile(paths.totalContributions);
      await removeFile(paths.followers);
      await removeFile(paths.country);
      continue;
    }

    const users = caches[country.slug] ?? [];
    publishedCountries.push({ ...country, userCount: users.length });
    await writeText(paths.publicContributions, renderLeaderboard({ country, users, category: "publicContributions", generatedAt }));
    await writeText(paths.totalContributions, renderLeaderboard({ country, users, category: "totalContributions", generatedAt }));
    await writeText(paths.followers, renderLeaderboard({ country, users, category: "followers", generatedAt }));
    await writeText(paths.country, renderCountryHub({ country, users, generatedAt }));
  }

  publishedCountries.sort((a, b) => a.name.localeCompare(b.name));
  await writeText(README_PATH, renderReadme({ countries: publishedCountries, generatedAt }));
  await writeText(`${MARKDOWN_DIRS.root}/README.md`, renderMainIndex({ countries: publishedCountries, generatedAt }));
  await writeText(`${MARKDOWN_DIRS.root}/status.md`, renderStatus({ countries, state: effectiveState, generatedAt }));

  for (const category of CATEGORY_KEYS) {
    await writeText(`${MARKDOWN_DIRS[category]}/README.md`, renderCategoryIndex({ countries: publishedCountries, category, generatedAt }));
  }
}

function isComplete(state, slug) {
  const status = state?.countries?.[slug]?.status;
  return state?.version === 3 && (status === "complete" || status === "refreshing");
}

function markdownPaths(slug) {
  return {
    country: `${MARKDOWN_DIRS.countries}/${slug}.md`,
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
