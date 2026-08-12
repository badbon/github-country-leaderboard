import { loadLocations } from "../lib/locations.js";
import { generateMarkdown } from "../lib/generator.js";

await generateMarkdown({ countries: await loadLocations() });
console.log("Generated markdown leaderboards");
