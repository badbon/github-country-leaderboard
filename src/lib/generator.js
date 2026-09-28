import { CACHE_DIR, MARKDOWN_DIRS, README_PATH, STATE_PATH } from "./paths.js";
import { readJson, removeFile, writeTextIfChanged } from "./storage.js";
import {
  CATEGORY_KEYS,
  renderCategoryIndex,
  renderCountryHub,
  renderLeaderboard,
  renderMainIndex,
  renderReadme,
  renderStatus
} from "./render.js";

export async function generateMarkdown({ countries, generatedAt = new Date().toISOString(), state = null }) {
  const effectiveState = state ?? await readJson(STATE_PATH, null);
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

    const users = await readJson(`${CACHE_DIR}/${country.slug}.json`, []);
    const countryGeneratedAt = effectiveState.countries[country.slug].lastCacheChangeAt
      ?? effectiveState.countries[country.slug].lastDiscoveryCompletedAt
      ?? generatedAt;
    publishedCountries.push({ ...country, userCount: users.length });
    await writeTextIfChanged(paths.publicContributions, renderLeaderboard({ country, users, category: "publicContributions", generatedAt: countryGeneratedAt }));
    await writeTextIfChanged(paths.totalContributions, renderLeaderboard({ country, users, category: "totalContributions", generatedAt: countryGeneratedAt }));
    await writeTextIfChanged(paths.followers, renderLeaderboard({ country, users, category: "followers", generatedAt: countryGeneratedAt }));
    await writeTextIfChanged(paths.country, renderCountryHub({ country, users, generatedAt: countryGeneratedAt }));
  }

  publishedCountries.sort((a, b) => a.name.localeCompare(b.name));
  await writeTextIfChanged(README_PATH, renderReadme({ countries: publishedCountries, generatedAt }));
  await writeTextIfChanged(`${MARKDOWN_DIRS.root}/README.md`, renderMainIndex({ countries: publishedCountries, generatedAt }));
  await writeTextIfChanged(`${MARKDOWN_DIRS.root}/status.md`, renderStatus({ countries, state: effectiveState, generatedAt }));

  for (const category of CATEGORY_KEYS) {
    await writeTextIfChanged(`${MARKDOWN_DIRS[category]}/README.md`, renderCategoryIndex({ countries: publishedCountries, category, generatedAt }));
  }
}

function isComplete(state, slug) {
  const country = state?.countries?.[slug];
  return state?.version === 3 && Boolean(
    country?.lastDiscoveryCompletedAt || country?.status === "complete" || country?.status === "refreshing"
  );
}

function markdownPaths(slug) {
  return {
    country: `${MARKDOWN_DIRS.countries}/${slug}.md`,
    publicContributions: `${MARKDOWN_DIRS.publicContributions}/${slug}.md`,
    totalContributions: `${MARKDOWN_DIRS.totalContributions}/${slug}.md`,
    followers: `${MARKDOWN_DIRS.followers}/${slug}.md`
  };
}
