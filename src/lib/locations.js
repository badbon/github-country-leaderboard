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
  return countries.flatMap((country) => {
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
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}
