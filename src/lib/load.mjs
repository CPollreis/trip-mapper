// Loads a trip with its city, its private overlay and its routing cache, runs
// validation, and derives the travel legs between consecutive stops.
import { readFileSync, existsSync } from 'node:fs';
import { validate } from './validate.mjs';
import { haversineKm, inferMode, legDuration, DETOUR, MODES } from './modes.mjs';
import { pickTrip } from './trips.mjs';
import { pathToFileURL } from 'node:url';

// Vite rewrites import.meta.url when it bundles this for the build, so a path
// relative to this file stops pointing at the project. Everything that loads
// trips runs from the project root (astro build, npm run scripts), so cwd is
// the dependable anchor.
const ROOT = pathToFileURL(process.cwd() + '/');
const readJSON = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const has = (p) => existsSync(new URL(p, ROOT));

export function loadTrip(arg, { applyOverlay = true } = {}) {
  const { path, slug } = pickTrip(ROOT, arg);
  const trip = readJSON(path);

  const citySlug = trip.trip.citySlug || trip.trip.city?.toLowerCase().replace(/\s+/g, '-');
  const cityPath = `cities/${citySlug}.json`;
  const city = has(cityPath) ? readJSON(cityPath) : null;

  // resources/ is gitignored, so this only ever exists on a machine that put it
  // there. A CI checkout has no overlay and therefore builds the public version.
  let overlaid = 0;
  const overlayPath = 'resources/private.json';
  const overlayPresent = has(overlayPath);
  if (applyOverlay && overlayPresent) {
    const priv = readJSON(overlayPath);
    const index = new Map(trip.places.map((p) => [p.id, p]));
    for (const [id, patch] of Object.entries(priv.places ?? {})) {
      const target = index.get(id);
      if (!target) continue;
      const { source, ...rest } = patch;
      Object.assign(target, rest);
      if (source) Object.assign(target.source, source);
      overlaid++;
    }
  }

  // A private cache is routed from real coordinates and is gitignored. It wins
  // locally; CI has only the public one.
  const privRoutes = `resources/${slug}.routes.json`;
  const pubRoutes = `trips/${slug}.routes.json`;
  const routesPath = applyOverlay && has(privRoutes) ? privRoutes
    : has(pubRoutes) ? pubRoutes : null;
  const routes = routesPath ? readJSON(routesPath) : { legs: {} };
  const routesArePrivate = routesPath === privRoutes;

  const { errors, warnings, byId, mapped } = validate(trip, city);
  const legs = errors.length ? [] : buildLegs(trip, byId, routes);

  return { slug, path, trip, city, routes, legs, errors, warnings, byId, mapped,
           overlaid, overlayPresent, routesArePrivate };
}

export const legKey = (a, b) => `${a}>${b}`;

// One leg per consecutive pair of mappable stops within a day. Items with no
// place (a flight, a checkout) are skipped rather than breaking the chain, so
// "check out, then museum" still connects the previous stop to the museum.
export function buildLegs(trip, byId, routes = { legs: {} }) {
  const out = [];
  for (const day of trip.days) {
    const stops = day.items
      .map((it) => ({ it, p: it.placeId ? byId.get(it.placeId) : null }))
      .filter(({ p }) => p && typeof p.lat === 'number');

    for (let i = 1; i < stops.length; i++) {
      const from = stops[i - 1], to = stops[i];
      if (from.p.id === to.p.id) continue;

      const cached = routes.legs?.[legKey(from.p.id, to.p.id)];
      const straightKm = haversineKm(from.p, to.p);
      const roadKm = cached?.roadKm ?? straightKm * DETOUR;
      const mode = to.it.mode || from.it.modeTo || inferMode(roadKm);
      const minutes = legDuration(mode, roadKm, cached?.carMin);

      out.push({
        date: day.date, dayNumber: day.dayNumber, color: day.color,
        fromId: from.p.id, toId: to.p.id,
        from: { lat: from.p.lat, lon: from.p.lon, name: from.p.name },
        to: { lat: to.p.lat, lon: to.p.lon, name: to.p.name },
        mode, minutes,
        km: Math.round(roadKm * 10) / 10,
        routed: Boolean(cached),
        depart: from.it.end || from.it.start,
        arrive: to.it.start,
      });
    }
  }
  return out;
}

// Does the schedule actually allow the travel time between two stops?
export function legSlack(leg, toMin) {
  if (!leg.depart || !leg.arrive) return null;
  const gap = toMin(leg.arrive) - toMin(leg.depart);
  if (gap == null || Number.isNaN(gap)) return null;
  return gap - leg.minutes;
}

export { MODES };
