import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("queued collection runs check out the latest selected branch", async () => {
  const workflow = await readFile(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("ref: ${{ github.ref_name }}"));
  assert.ok(workflow.includes("cancel-in-progress: false"));
});
