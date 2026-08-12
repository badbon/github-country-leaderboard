import { includesPhrase, normalizeText } from "./text.js";

export function classifyLocation(rawLocation, countries) {
  const normalized = normalizeText(rawLocation);
  if (!normalized) return null;

  for (const country of countries) {
    if (country.normalizedOverrides.some((term) => includesPhrase(normalized, term))) {
      return country.slug;
    }
  }

  for (const country of countries) {
    if (country.normalizedAliases.some((term) => includesPhrase(normalized, term))) {
      return country.slug;
    }
  }

  for (const country of countries) {
    if (country.normalizedCities.some((term) => includesPhrase(normalized, term))) {
      return country.slug;
    }
  }

  return null;
}
