import { includesPhrase, normalizeText } from "./text.js";

export function classifyLocation(rawLocation, countries) {
  const normalized = normalizeText(rawLocation);
  if (!normalized) return null;
  const components = locationComponents(rawLocation);

  if (isGeorgiaUsStateLocation(normalized)) {
    return "united_states";
  }

  for (const country of countries) {
    if (country.normalizedOverrides.some((term) => includesPhrase(normalized, term))) {
      return country.slug;
    }
  }

  const aliasMatch = bestComponentMatch(countries, components, "normalizedAliases");
  if (aliasMatch) {
    return aliasMatch.slug;
  }

  for (const country of countries) {
    if (country.normalizedCities.some((term) => includesPhrase(normalized, term))) {
      return country.slug;
    }
  }

  return null;
}

function isGeorgiaUsStateLocation(normalized) {
  if (!includesPhrase(normalized, "georgia")) return false;
  if (includesPhrase(normalized, "south georgia") && includesPhrase(normalized, "south sandwich islands")) {
    return false;
  }
  return [
    "usa",
    "us",
    "u s",
    "u s a",
    "united states",
    "unitedstates",
    "united states of america"
  ].some((term) => includesPhrase(normalized, term));
}

function bestComponentMatch(countries, components, key) {
  let best = null;
  for (const country of countries) {
    for (const term of country[key]) {
      if (!components.has(term)) continue;
      const score = term.split(" ").length;
      if (!best || score > best.score) {
        best = { slug: country.slug, score };
      }
    }
  }
  return best;
}

function locationComponents(rawLocation) {
  const components = new Set([normalizeText(rawLocation)]);
  for (const part of String(rawLocation ?? "").split(/[,;|/()[\]{}\n\r]+/u)) {
    const normalized = normalizeText(part);
    if (normalized) components.add(normalized);
  }
  return components;
}
