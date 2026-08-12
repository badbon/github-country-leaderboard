import test from "node:test";
import assert from "node:assert/strict";
import { loadLocations } from "../src/lib/locations.js";
import { classifyLocation } from "../src/lib/classifier.js";

test("classifies required location examples", async () => {
  const countries = await loadLocations();
  assert.equal(classifyLocation("Atlanta, Georgia", countries), "united_states");
  assert.equal(classifyLocation("Georgia", countries), "georgia");
  assert.equal(classifyLocation("Paris, Georgia", countries), "georgia");
  assert.equal(classifyLocation("France, Tbilisi", countries), "france");
});
