import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMarkdown } from "../src/lib/generator.js";
import { normalizeCountry } from "../src/lib/locations.js";
import { writeJson, writeText } from "../src/lib/storage.js";

test("generates markdown only for completed countries", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "leaderboard-generator-"));
  process.chdir(tempDir);

  try {
    const countries = ["georgia", "france"].map((slug) => normalizeCountry({
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
    await writeText("markdown/public_contributions/france.md", "stale");

    await generateMarkdown({ countries, state, generatedAt: "2026-08-13T00:00:00.000Z" });

    assert.match(await readFile("markdown/public_contributions/georgia.md", "utf8"), /nino/);
    await assert.rejects(() => access("markdown/public_contributions/france.md"), { code: "ENOENT" });
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});
