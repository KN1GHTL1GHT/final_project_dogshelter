// Builds data/dogs.json from the City of Austin open data portal.
// Run with:  node scripts/build-data.mjs
//
// Source: "Austin Animal Center Outcomes" (gsvs-ypi7). It is the companion to
// the Intakes dataset (pyqf-r2dc) and is the one that carries both the intake
// date and the outcome date, which is what "time spent in the shelter" needs.
//
// Every usable dog + puppy stay is kept. To stay under the 1 MB class limit
// the file is written in a compact shape: one list of column names, then one
// short array per dog in that same order (script.js turns them back into objects).

import { writeFile, mkdir } from "node:fs/promises";

const URL =
  "https://data.austintexas.gov/resource/gsvs-ypi7.json" +
  "?$where=" + encodeURIComponent("type in('Dog','Puppy')") +
  "&$limit=50000";

// Records that were never really "in the shelter"
const SKIP_STATUS = /^(DOA|Cremation|Unresolved File|Lost)/i;

const response = await fetch(URL);
const rows = await response.json();
console.log("downloaded", rows.length, "dog/puppy outcomes");

const usable = rows.filter(function (row) {
  if (!row.date_of_birth || !row.intake_date || !row.outcome_date) return false;
  if (SKIP_STATUS.test(row.outcome_status)) return false;
  if (new Date(row.outcome_date) < new Date(row.intake_date)) return false;
  if (new Date(row.date_of_birth) > new Date(row.intake_date)) return false;
  return true;
});
console.log("usable", usable.length);

usable.sort((a, b) => Number(a.id) - Number(b.id));

const columns = ["id", "name", "type", "sex", "breed", "color", "secondaryColor", "birthDate", "intakeDate", "outcomeDate", "outcome"];

const rowsOut = usable.map(function (row) {
  return [
    row.id,
    row.name || null,
    row.type,
    row.sex || null,
    row.primary_breed,
    row.primary_color,
    row.secondary_color || null,
    row.date_of_birth.slice(0, 10),
    row.intake_date.slice(0, 16), // minutes are precise enough
    row.outcome_date.slice(0, 16),
    row.outcome_status,
  ];
});

const output = {
  source: "https://data.austintexas.gov/d/gsvs-ypi7",
  downloaded: new Date().toISOString().slice(0, 10),
  columns: columns,
  dogs: rowsOut,
};

await mkdir("data", { recursive: true });
const json = JSON.stringify(output);
await writeFile("data/dogs.json", json);
console.log("wrote data/dogs.json:", rowsOut.length, "dogs,", Math.round(json.length / 1024), "KB");
