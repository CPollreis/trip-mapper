#!/usr/bin/env node
// Validates a trip file and generates its site + exports. Never mutates input.
//
//   node build.mjs [trips/my-trip.json]
//
// With no argument it uses the only file in trips/, or lists them and exits.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pickTrip } from './lib/trips.mjs';

const root = new URL('./', import.meta.url);
const rel = (p) => new URL(p, root);

const { path: tripPath, slug } = pickTrip(root, process.argv[2]);
const trip = JSON.parse(readFileSync(rel(tripPath), 'utf8'));

const citySlug = trip.trip.citySlug || trip.trip.city?.toLowerCase().replace(/\s+/g, '-');
const cityPath = `cities/${citySlug}.json`;
const city = existsSync(rel(cityPath)) ? JSON.parse(readFileSync(rel(cityPath), 'utf8')) : null;

// resources/ is gitignored, so anything here stays on this machine. Fields named
// in the overlay replace the same fields on the matching place, which keeps real
// addresses out of git while the local build still has them.
const privatePath = 'resources/private.json';
let overlaid = 0;
if (existsSync(rel(privatePath))) {
  const priv = JSON.parse(readFileSync(rel(privatePath), 'utf8'));
  const index = new Map(trip.places.map((p) => [p.id, p]));
  for (const [id, patch] of Object.entries(priv.places ?? {})) {
    const target = index.get(id);
    if (!target) {
      console.warn(`warn  ${privatePath}: no place with id "${id}"`);
      continue;
    }
    const { source, ...rest } = patch;
    Object.assign(target, rest);
    if (source) Object.assign(target.source, source);
    overlaid++;
  }
}

const outDir = `dist/${slug}/`;
mkdirSync(rel(outDir), { recursive: true });

const CATEGORIES = ['food', 'coffee', 'bar', 'sight', 'activity', 'shop', 'outdoors',
  'lodging', 'venue', 'conference'];
const TYPES = ['meal', 'coffee', 'drinks', 'activity', 'sight', 'outdoors',
  'transit', 'fixed', 'free', 'lodging', 'show'];
const CONFIDENCE = ['confirmed', 'inferred', 'unresolved'];
const LEVEL = { required: 'MUST BOOK', recommended: 'book ahead', held: 'already held' };

const errors = [];
const warnings = [];
if (!city) warnings.push(`no ${cityPath}; the map will draw pins without reference geography`);

/* ---------------- validate ---------------- */

const byId = new Map();
const mapped = [];
for (const p of trip.places) {
  if (byId.has(p.id)) errors.push(`duplicate place id: ${p.id}`);
  byId.set(p.id, p);
  if (!p.name) errors.push(`place ${p.id}: missing name`);
  if (!CATEGORIES.includes(p.category)) errors.push(`place ${p.id}: bad category "${p.category}"`);

  const conf = p.source?.confidence;
  if (!CONFIDENCE.includes(conf)) errors.push(`place ${p.id}: bad source.confidence "${conf}"`);

  if (p.booking && !LEVEL[p.booking.level])
    errors.push(`place ${p.id}: bad booking.level "${p.booking.level}"`);

  if (conf === 'unresolved') {
    if (p.lat != null || p.lon != null)
      warnings.push(`place ${p.id}: unresolved but has coordinates; promote it to inferred`);
    continue;
  }
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number') {
    errors.push(`place ${p.id}: ${conf} places need numeric lat/lon`);
    continue;
  }
  if (city?.bounds) {
    const [la0, la1] = city.bounds.lat, [lo0, lo1] = city.bounds.lon;
    if (p.lat < la0 || p.lat > la1 || p.lon < lo0 || p.lon > lo1)
      errors.push(`place ${p.id}: ${p.lat},${p.lon} is outside ${city.name}`);
  }
  mapped.push(p);
}

// Without a city file there is no box to check against, so catch the same class
// of error generically: a sign flip or a lat/lon swap throws a point thousands
// of km from the rest of the trip.
if (!city?.bounds && mapped.length > 2) {
  const mid = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const cLat = mid(mapped.map((p) => p.lat)), cLon = mid(mapped.map((p) => p.lon));
  for (const p of mapped) {
    const km = Math.hypot((p.lat - cLat) * 111, (p.lon - cLon) * 111 * Math.cos(cLat * Math.PI / 180));
    if (km > 150) errors.push(`place ${p.id}: ${p.lat},${p.lon} is ${Math.round(km)} km from the rest of the trip`);
  }
}

const toMin = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(t || '');
  return m ? +m[1] * 60 + +m[2] : null;
};

for (const day of trip.days) {
  const seen = [];
  for (const it of day.items) {
    const where = `${day.date} ${it.start ?? '??:??'}`;
    if (toMin(it.start) == null) errors.push(`${where}: start must be HH:MM`);
    if (it.end && toMin(it.end) == null) errors.push(`${where}: end must be HH:MM`);
    if (!TYPES.includes(it.type)) errors.push(`${where}: bad type "${it.type}"`);
    if (typeof it.locked !== 'boolean') errors.push(`${where}: locked must be true/false`);
    if (!it.placeId && !it.title) errors.push(`${where}: needs a placeId or a title`);
    if (it.placeId && !byId.has(it.placeId)) errors.push(`${where}: unknown placeId "${it.placeId}"`);
    if (it.placeId && byId.get(it.placeId)?.source?.confidence === 'unresolved')
      warnings.push(`${where}: scheduled "${it.placeId}" which is still unresolved`);

    const s = toMin(it.start), e = it.end ? toMin(it.end) : null;
    if (s != null && e != null && e <= s) errors.push(`${where}: end is not after start`);
    if (s != null && e != null) {
      for (const [ps, pe, pl] of seen)
        if (s < pe && ps < e) warnings.push(`${day.date}: "${it.placeId || it.title}" overlaps "${pl}"`);
      seen.push([s, e, it.placeId || it.title]);
    }
  }
  const starts = day.items.map((i) => toMin(i.start)).filter((n) => n != null);
  if (starts.some((n, i) => i && n < starts[i - 1]))
    warnings.push(`${day.date}: items are not in chronological order`);
}

const scheduled = new Set(trip.days.flatMap((d) => d.items.map((i) => i.placeId).filter(Boolean)));
for (const p of trip.places)
  if (!scheduled.has(p.id) && p.source?.confidence !== 'unresolved' && !p.shortlist)
    warnings.push(`place ${p.id} ("${p.name}") is not scheduled and is not on the shortlist`);

if (errors.length) {
  for (const w of warnings) console.warn(`warn  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n${errors.length} errors. Nothing written.`);
  process.exit(1);
}

/* ---------------- generate ---------------- */

const write = (name, body) => writeFileSync(rel(outDir + name), body);
const unresolved = trip.places.filter((p) => p.source?.confidence === 'unresolved');
const shortlist = trip.places.filter((p) => p.shortlist);

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rows = [['Name', 'Latitude', 'Longitude', 'Day', 'Date', 'Time', 'Category', 'Neighbourhood', 'Notes', 'Source']];
for (const day of trip.days)
  for (const it of day.items) {
    const p = it.placeId ? byId.get(it.placeId) : null;
    if (!p || typeof p.lat !== 'number') continue;
    rows.push([p.name, p.lat, p.lon, `Day ${day.dayNumber}`, day.date,
      it.end ? `${it.start}-${it.end}` : it.start, p.category, p.neighbourhood,
      [it.notes, p.notes].filter(Boolean).join(' / '), p.source?.url ?? '']);
  }
write('mymaps.csv', rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

write('unresolved.md',
  `# Sources I could not pin to a venue\n\n` +
  (unresolved.length
    ? `These ${unresolved.length} named no venue I could verify. To rescue one: give it a name,\n` +
      `\`lat\`/\`lon\` and confidence \`confirmed\` in the trip file, then rebuild.\n\n` +
      unresolved.map((p) => `### ${p.source.handle || p.id}\n\n${p.source.url}\n\n${p.notes || '(no detail recorded)'}\n`).join('\n')
    : 'None. Every source resolved to a venue.\n'));

write('shortlist.md',
  `# Shortlist: nearby, unscheduled\n\nVenues that resolved but did not earn a slot.\n` +
  `Kept here so a cancelled plan or an open evening has somewhere to go.\n\n` +
  (shortlist.length
    ? shortlist.map((p) => `- **${p.name}** (${p.category}) - ${p.neighbourhood || city?.name || ''}\n  ${p.address}\n  ${p.notes}\n`).join('\n')
    : 'Nothing shortlisted.\n'));

const toBook = [];
for (const day of trip.days)
  for (const it of day.items) {
    const p = it.placeId ? byId.get(it.placeId) : null;
    if (p?.booking) toBook.push({ day, it, p });
  }
write('reservations.md',
  `# Book these before you go\n\n` +
  (trip.trip.bookingNote ? trip.trip.bookingNote + '\n\n' : '') +
  (toBook.length
    ? `| when | what | status | how |\n|---|---|---|---|\n` +
      toBook.map(({ day, it, p }) =>
        `| ${day.date} ${it.start} | ${p.name} | **${LEVEL[p.booking.level]}** | ${p.booking.how} |`).join('\n') + '\n'
    : 'Nothing needs booking yet.\n'));

const fmtDay = (d) => {
  const head = `## Day ${d.dayNumber} - ${d.weekday} ${d.date}${d.label ? ` - ${d.label}` : ''}`;
  if (!d.items.length) return `${head}\n\n_open_\n`;
  return `${head}\n\n` + d.items.map((it) => {
    const p = it.placeId ? byId.get(it.placeId) : null;
    const when = it.end ? `${it.start}-${it.end}` : it.start;
    const tail = [p?.neighbourhood, it.notes].filter(Boolean).join(' · ');
    return `- ${it.locked ? '**[yours]** ' : ''}\`${when}\` ${p ? p.name : it.title}${tail ? ` - ${tail}` : ''}`;
  }).join('\n') + '\n';
};
write('itinerary.md',
  `# ${trip.trip.title || trip.trip.city}, ${trip.trip.start} to ${trip.trip.end}\n\n` +
  trip.days.map(fmtDay).join('\n'));

// the page: template with data, title and per-line colour tokens inlined
const template = readFileSync(rel('lib/template.html'), 'utf8');
const lines = city?.lines ?? [];
const tok = (dark) => lines.map((l, i) => `    --line-${i}: ${dark ? l.colorDark || l.color : l.color};`).join('\n');
const lineTokens = lines.length
  ? `:root {\n${tok(false)}\n  }\n` +
    `  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {\n${tok(true)}\n  } }\n` +
    `  :root[data-theme="dark"] {\n${tok(true)}\n  }`
  : '';
const title = trip.trip.title || `${trip.trip.city} trip`;
write('index.html', template
  .replace('__TITLE__', title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')))
  .replace('/*__LINE_TOKENS__*/', lineTokens)
  .replace('/*__DATA__*/', JSON.stringify({
    trip: trip.trip,
    places: trip.places.filter((p) => typeof p.lat === 'number'),
    days: trip.days,
    city: city ? { name: city.name, shore: city.shore, lines: city.lines, stations: city.stations, labels: city.labels } : null,
  })));

/* ---------------- report ---------------- */
for (const w of warnings) console.warn(`warn  ${w}`);
console.log(`\n${slug}${city ? ` (${city.name})` : ''} -> ${outDir}`);
if (overlaid) console.log(`${overlaid} places patched from ${privatePath} (local only)`);
console.log(`${trip.places.length} places (${mapped.length} mapped, ${unresolved.length} unresolved, ${shortlist.length} shortlisted), ` +
  `${trip.days.reduce((n, d) => n + d.items.length, 0)} items, ${rows.length - 1} map pins`);
console.log(`0 errors, ${warnings.length} warnings`);
