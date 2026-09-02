import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMarkdown } from "../src/lib/generator.js";
import { normalizeCountry } from "../src/lib/locations.js";
import { writeJson, writeText } from "../src/lib/storage.js";

test("generates markdown only for baseline-complete countries", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-generator-"));
  process.chdir(tempDir);

  try {
    const countries = ["georgia", "italy", "france"].map((slug) => normalizeCountry({
      slug,
      name: slug[0].toUpperCase() + slug.slice(1),
      iso2: slug.slice(0, 2).toUpperCase(),
      aliases: [slug],
      cities: [],
      overrides: []
    }));
    const state = {
      version: 3,
      countries: {
        georgia: { status: "complete" },
        italy: { status: "refreshing" },
        france: { status: "discovering" }
      }
    };

    await writeJson("cache/georgia.json", [{
      login: "nino",
      name: "",
      company: "",
      twitterUsername: "",
      location: "Tbilisi, Georgia",
      followers: 1,
      publicContributions: 10,
      privateContributions: 0
    }]);
    await writeJson("cache/france.json", []);
    await writeJson("cache/italy.json", [{
      login: "giulia",
      name: "",
      company: "",
      twitterUsername: "",
      location: "Italy",
      followers: 1,
      publicContributions: 8,
      privateContributions: 0
    }]);
    await writeText("markdown/public_contributions/france.md", "stale");

    await generateMarkdown({ countries, state, generatedAt: "2026-08-13T00:00:00.000Z" });

    assert.match(await readFile("README.md", "utf8"), /Daily Countries/);
    assert.match(await readFile("markdown/README.md", "utf8"), /\[Georgia\]\(countries\/georgia\.md\)/);
    assert.match(await readFile("markdown/status.md", "utf8"), /Countries published/);
    assert.match(await readFile("markdown/public_contributions/README.md", "utf8"), /\[View\]\(\.\/georgia\.md\)/);
    assert.match(await readFile("markdown/countries/georgia.md", "utf8"), /## Total Contributions/);
    assert.match(await readFile("markdown/public_contributions/georgia.md", "utf8"), /nino/);
    assert.match(await readFile("markdown/public_contributions/italy.md", "utf8"), /giulia/);
    await assert.rejects(() => access("markdown/public_contributions/france.md"), { code: "ENOENT" });
    await assert.rejects(() => access("markdown/countries/france.md"), { code: "ENOENT" });
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});
