import { LOCATIONS_PATH } from "./paths.js";
import { readJson } from "./storage.js";
import { normalizeText } from "./text.js";

export async function loadLocations(path = LOCATIONS_PATH) {
  const data = await readJson(path);
  if (!data?.countries?.length) {
    throw new Error(`No countries found in ${path}`);
  }
  return data.countries.map(normalizeCountry);
}

export function normalizeCountry(country) {
  const aliases = unique([country.name, ...(country.aliases ?? [])]);
  const cities = unique(country.cities ?? []);
  const overrides = unique(country.overrides ?? []);
  return {
    ...country,
    aliases,
    cities,
    overrides,
    normalizedAliases: aliases.map(normalizeText),
    normalizedCities: cities.map(normalizeText),
    normalizedOverrides: overrides.map(normalizeText)
  };
}

export function buildTerms(countries) {
  const terms = countries.flatMap((country) => {
    const countryTerms = country.aliases.map((term) => ({
      country: country.slug,
      term,
      kind: "country"
    }));
    const cityTerms = country.cities.map((term) => ({
      country: country.slug,
      term,
      kind: "city"
    }));
    return [...countryTerms, ...cityTerms];
  });
  const byKey = new Map();
  for (const term of terms) {
    const key = `${term.country}|${term.kind}|${normalizeText(term.term)}`;
    if (!byKey.has(key)) byKey.set(key, term);
  }
  return [...byKey.values()];
}

function unique(values) {
  const byKey = new Map();
  for (const value of values.map((item) => String(item).trim()).filter(Boolean)) {
    const key = normalizeText(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}
