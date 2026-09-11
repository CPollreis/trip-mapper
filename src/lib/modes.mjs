// Travel modes, and how a leg's duration is worked out.
//
// The public OSRM server only hosts the car profile. It accepts "walking" and
// "cycling" in the URL but silently answers with car routing, so its durations
// are useless for anything but driving. What it does give honestly is the road
// DISTANCE, which beats straight-line by a wide margin (9.9 km of road for a
// 7.9 km straight line across Toronto's east end).
//
// So: road distance comes from OSRM, and every non-driving time is that
// distance at a mode speed. Driving uses OSRM's own duration.

export const MODES = {
  walk:    { label: 'Walk',    kmh: 4.8, overhead: 0, color: '#25c6eb', dash: '2 4' },
  transit: { label: 'Transit', kmh: 20,  overhead: 9, color: '#2563eb', dash: null },
  bike:    { label: 'Bike',    kmh: 15,  overhead: 3, color: '#4a25eb', dash: '8 4' },
  drive:   { label: 'Drive',   kmh: 30,  overhead: 5, color: '#a1a1aa', dash: null },
};

export const EARTH_KM = 6371;

export function haversineKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// Streets are never straight. Without a routed distance this is the usual
// correction for a dense grid, and it is flagged as an estimate downstream.
export const DETOUR = 1.32;

// 1.8 km of road is about a 22 minute walk. Below that, waiting for a vehicle
// usually costs more than it saves, which matches how people actually move
// around a dense core. Override per item with "mode" in the trip file.
export const WALK_LIMIT_KM = 1.8;

export function inferMode(roadKm) {
  return roadKm <= WALK_LIMIT_KM ? 'walk' : 'transit';
}

export function legDuration(mode, roadKm, carMinutes) {
  const m = MODES[mode] ?? MODES.transit;
  if (mode === 'drive' && typeof carMinutes === 'number')
    return Math.round(carMinutes + m.overhead);
  return Math.round((roadKm / m.kmh) * 60 + m.overhead);
}

export const fmtDuration = (min) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
