#!/usr/bin/env node
// Creates a new trip file with the day skeleton filled in.
//
//   npm run new-trip -- --city toronto --start 2026-09-20 --end 2026-10-02
//   npm run new-trip -- --city lisbon --start 2027-04-02 --end 2027-04-09 \
//     --name lisbon-spring --title "Lisbon in April"
import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dayRamp } from './color.mjs';

const root = new URL('../', import.meta.url);
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : undefined; };

const city = flag('city');
const start = flag('start');
const end = flag('end');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));

if (!city || !isDate(start) || !isDate(end)) {
  console.error('Usage: npm run new-trip -- --city <slug> --start <YYYY-MM-DD> --end <YYYY-MM-DD>');
  console.error('Options: --name <file-slug>  --title "Display title"');
  const dir = new URL('cities/', root);
  if (existsSync(dir)) {
    const have = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
    if (have.length) console.error(`\nCities with map geometry: ${have.join(', ')}`);
  }
  console.error('A city with no file still works; the map just draws pins without reference geography.');
  process.exit(1);
}
if (Date.parse(end) < Date.parse(start)) {
  console.error('--end is before --start');
  process.exit(1);
}

const name = flag('name') || `${city}-${start.slice(0, 7)}`;
const cityName = city.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const out = new URL(`trips/${name}.json`, root);

if (existsSync(out)) {
  console.error(`trips/${name}.json already exists. Pass a different --name.`);
  process.exit(1);
}

const days = [];
for (let d = new Date(start + 'T12:00:00Z'); ; d.setUTCDate(d.getUTCDate() + 1)) {
  const iso = d.toISOString().slice(0, 10);
  days.push(iso);
  if (iso === end) break;
  if (days.length > 400) { console.error('Range too long.'); process.exit(1); }
}

const colors = dayRamp(days.length);
const weekday = (iso) => new Date(iso + 'T12:00:00Z')
  .toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'UTC' });

const trip = {
  _readme: 'A single trip. See schema.md. Build with `npm run build`, preview with `npm run dev`.',
  trip: {
    city: cityName,
    citySlug: city,
    title: flag('title') || `${cityName} ${days.length} Days`,
    start, end,
    bookingNote: '',
  },
  places: [],
  days: days.map((date, i) => ({
    date, dayNumber: i + 1, weekday: weekday(date),
    label: '', color: colors[i], base: '', items: [],
  })),
};

mkdirSync(new URL('trips/', root), { recursive: true });
writeFileSync(out, JSON.stringify(trip, null, 2) + '\n');
console.log(`Wrote trips/${name}.json: ${days.length} days, ${start} to ${end}`);
if (!existsSync(new URL(`cities/${city}.json`, root)))
  console.log(`No cities/${city}.json yet. The map will draw pins only. See README "Adding a city".`);
console.log(`\nNext:\n  npm run dev -- trips/${name}.json`);
