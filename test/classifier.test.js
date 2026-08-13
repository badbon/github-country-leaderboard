import test from "node:test";
import assert from "node:assert/strict";
import { loadLocations } from "../src/lib/locations.js";
import { classifyLocation } from "../src/lib/classifier.js";

test("classifies required location examples", async () => {
  const countries = await loadLocations();
  assert.equal(classifyLocation("Atlanta, Georgia", countries), "united_states");
  assert.equal(classifyLocation("Georgia", countries), "georgia");
  assert.equal(classifyLocation("Paris, Georgia", countries), "georgia");
  assert.equal(classifyLocation("Tbilisi, Georgia", countries), "georgia");
  assert.equal(classifyLocation("France, Tbilisi", countries), "france");
  assert.equal(classifyLocation("Rio de Janeiro, Brazil", countries), "brazil");
});

test("keeps Georgia country separate from common Georgia US state locations", async () => {
  const countries = await loadLocations();
  assert.equal(classifyLocation("Georgia, USA", countries), "united_states");
  assert.equal(classifyLocation("UnitedStates Georgia", countries), "united_states");
  assert.equal(classifyLocation("North Georgia", countries), "united_states");
  assert.equal(classifyLocation("Georgia Tech, USA", countries), "united_states");
  assert.equal(classifyLocation("Pooler, Georgia, 31322 United States of America", countries), "united_states");
  assert.equal(classifyLocation("Georgia, Atlanta, USA", countries), "united_states");
  assert.equal(
    classifyLocation("South Georgia and the South Sandwich Islands", countries),
    "south_georgia"
  );
});
