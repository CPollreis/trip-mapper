// Pure validation. Returns errors and warnings; never writes, never exits.
export const CATEGORIES = ['food', 'coffee', 'bar', 'sight', 'activity', 'shop',
  'outdoors', 'lodging', 'venue', 'conference'];
export const TYPES = ['meal', 'coffee', 'drinks', 'activity', 'sight', 'outdoors',
  'transit', 'fixed', 'free', 'lodging', 'show'];
export const CONFIDENCE = ['confirmed', 'inferred', 'unresolved'];
export const BOOKING_LEVEL = { required: 'MUST BOOK', recommended: 'book ahead', held: 'already held' };
const MODE_NAMES = ['walk', 'transit', 'bike', 'drive'];

const toMin = (t) => {
  const m = /^(\d{2}):(\d{2})$/.exec(t || '');
  return m ? +m[1] * 60 + +m[2] : null;
};

export function validate(trip, city) {
  const errors = [];
  const warnings = [];
  const byId = new Map();
  const mapped = [];

  for (const p of trip.places) {
    if (byId.has(p.id)) errors.push(`duplicate place id: ${p.id}`);
    byId.set(p.id, p);
    if (!p.name) errors.push(`place ${p.id}: missing name`);
    if (!CATEGORIES.includes(p.category)) errors.push(`place ${p.id}: bad category "${p.category}"`);

    const conf = p.source?.confidence;
    if (!CONFIDENCE.includes(conf)) errors.push(`place ${p.id}: bad source.confidence "${conf}"`);
    if (p.booking && !BOOKING_LEVEL[p.booking.level])
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

  // Without city bounds, catch sign flips and lat/lon swaps by distance instead.
  if (!city?.bounds && mapped.length > 2) {
    const mid = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const cLat = mid(mapped.map((p) => p.lat)), cLon = mid(mapped.map((p) => p.lon));
    for (const p of mapped) {
      const km = Math.hypot((p.lat - cLat) * 111,
        (p.lon - cLon) * 111 * Math.cos((cLat * Math.PI) / 180));
      if (km > 150)
        errors.push(`place ${p.id}: ${p.lat},${p.lon} is ${Math.round(km)} km from the rest of the trip`);
    }
  }

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
      if (it.mode && !MODE_NAMES.includes(it.mode))
        errors.push(`${where}: bad mode "${it.mode}", expected ${MODE_NAMES.join(', ')}`);
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

  return { errors, warnings, byId, mapped };
}

export { toMin };
