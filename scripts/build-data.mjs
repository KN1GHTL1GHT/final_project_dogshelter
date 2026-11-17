// Builds data/dogs.json from the City of Austin open data portal.
// Run with:  node scripts/build-data.mjs
//
// Source: "Austin Animal Center Outcomes" (gsvs-ypi7). It is the companion to
// the Intakes dataset (pyqf-r2dc) and is the one that carries both the intake
// date and the outcome date, which is what "time spent in the shelter" needs.
//
// The class limit is 1,000 records, so this takes a seeded random sample of
// dog + puppy stays. Same seed => same file every time.

import { writeFile, mkdir } from "node:fs/promises";

const SAMPLE_SIZE = 1000;
const SEED = 630;
const URL =
  "https://data.austintexas.gov/resource/gsvs-ypi7.json" +
  "?$where=" + encodeURIComponent("type in('Dog','Puppy')") +
  "&$limit=50000";

// Small seeded random number generator (mulberry32)
function makeRandom(seed) {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Fisher-Yates shuffle with the seeded generator, then take the first 1,000
usable.sort((a, b) => Number(a.id) - Number(b.id));
const random = makeRandom(SEED);
for (let i = usable.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [usable[i], usable[j]] = [usable[j], usable[i]];
}

const sample = usable.slice(0, SAMPLE_SIZE).map(function (row) {
  return {
    id: row.id,
    name: row.name || null,
    type: row.type,
    sex: row.sex || null,
    breed: row.primary_breed,
    color: row.primary_color,
    secondaryColor: row.secondary_color || null,
    birthDate: row.date_of_birth.slice(0, 10),
    intakeDate: row.intake_date,
    outcomeDate: row.outcome_date,
    outcome: row.outcome_status,
  };
});

await mkdir("data", { recursive: true });
await writeFile("data/dogs.json", JSON.stringify(sample));
console.log("wrote data/dogs.json with", sample.length, "records");
