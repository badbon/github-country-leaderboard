import { CACHE_DIR, MARKDOWN_DIRS } from "./paths.js";
import { readJson, writeJson, writeText } from "./storage.js";
import { renderLeaderboard } from "./render.js";

export async function generateMarkdown({ countries, generatedAt = new Date().toISOString() }) {
  for (const country of countries) {
    const cachePath = `${CACHE_DIR}/${country.slug}.json`;
    const users = await readJson(cachePath, null) ?? [];
    await writeJson(cachePath, users);
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
