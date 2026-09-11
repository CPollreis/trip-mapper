import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import type { TripData, Leg, Place, Day, Item } from './types';

// CARTO's dark basemap. Free, no key, and already the right value range for
// the portfolio's palette, so the trip data stays the only saturated thing
// on screen.
const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const fmt = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA',
    { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function TripApp({ data }: { data: TripData }) {
  const { trip, places, days, legs, modes } = data;
  const mapRef = useRef<MLMap | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState(true);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  // One stop per scheduled item that has a place, so a venue visited twice
  // gets a pin on each of its days.
  const stops = useMemo(() => {
    const out: { place: Place; day: Day; item: Item }[] = [];
    for (const day of days)
      for (const item of day.items) {
        const place = item.placeId ? byId.get(item.placeId) : undefined;
        if (place && typeof place.lat === 'number') out.push({ place, day, item });
      }
    return out;
  }, [days, byId]);

  useEffect(() => {
    const container = holder.current;
    if (!container) return;
    // No `mapRef.current` guard here on purpose. React runs effects twice in
    // dev, and a guard plus a cleanup that calls remove() can leave the ref
    // pointing at a torn-down map: the canvas keeps its last painted frame, so
    // the basemap still looks fine while no events fire and no layers exist.
    // Each invocation now owns and disposes exactly one map.
    const map = new maplibregl.Map({
      container,
      style: BASEMAP as unknown as StyleSpecification,
      center: [places[0]?.lon ?? -79.38, places[0]?.lat ?? 43.65],
      zoom: 11,
      attributionControl: false,
    });
    mapRef.current = map;
    // Handy in the console during dev: __map.queryRenderedFeatures(), etc.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__map = map;
    map.on('error', (e) => console.error('[map]', e?.error?.message ?? e));
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const setup = () => {
      // Idempotent: a re-entrant call must not throw on an existing source.
      if (map.getSource('legs')) return;
      map.addSource('legs', { type: 'geojson', data: legGeoJSON(legs) });
      map.addSource('stops', { type: 'geojson', data: stopGeoJSON(stops) });

      // line-dasharray takes no data-driven expression, so each mode gets its
      // own layer with a static dash and a filter.
      for (const [name, spec] of Object.entries(modes)) {
        map.addLayer({
          id: `leg-${name}`,
          type: 'line',
          source: 'legs',
          filter: ['==', ['get', 'mode'], name],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': spec.color,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 17, 5],
            'line-opacity': 0.85,
            ...(spec.dash ? { 'line-dasharray': spec.dash.split(' ').map(Number) } : {}),
          },
        });
      }

      map.addLayer({
        id: 'leg-label',
        type: 'symbol',
        source: 'legs',
        minzoom: 10.5,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#fafafa',
          'text-halo-color': '#09090b',
          'text-halo-width': 1.6,
        },
      });

      map.addLayer({
        id: 'stop-halo',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 13, 17, 17],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.18,
          'circle-stroke-width': 0,
        },
      });
      map.addLayer({
        id: 'stop-dot',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 9, 17, 12],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#09090b',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'stop-num',
        type: 'symbol',
        source: 'stops',
        minzoom: 10,
        layout: {
          'text-field': ['to-string', ['get', 'dayNumber']],
          'text-size': 10,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#09090b' },
      });

      map.on('click', 'stop-dot', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        new maplibregl.Popup({ offset: 14, closeButton: true })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div style="font-family:var(--font-sans);max-width:240px">
               <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${p.color}">
                 Day ${p.dayNumber} &middot; ${p.time}</div>
               <div style="font-weight:600;margin-top:3px">${esc(p.name)}</div>
               ${p.neighbourhood ? `<div style="font-size:12px;color:#a1a1aa">${esc(p.neighbourhood)}</div>` : ''}
               ${p.note ? `<div style="font-size:12px;color:#a1a1aa;margin-top:6px">${esc(p.note)}</div>` : ''}
             </div>`)
          .addTo(map);
      });
      for (const id of ['stop-dot', 'stop-halo']) {
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
      }

      fitTo(map, stops.map((s) => [s.place.lon, s.place.lat] as [number, number]));
      setReady(true);
    };

    // Wait for `load`. Adding sources before the style has parsed throws, and
    // catching that leaves a half-built style that never finishes loading and
    // renders nothing at all, basemap included.
    map.on('load', setup);

    return () => { setReady(false); map.remove(); mapRef.current = null; };
  }, []);

  // Day filter drives both the map layers and the rail.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const legFilterFor = (name: string) =>
      active === null
        ? (['==', ['get', 'mode'], name] as unknown as maplibregl.FilterSpecification)
        : (['all', ['==', ['get', 'mode'], name], ['==', ['get', 'dayNumber'], active]] as unknown as maplibregl.FilterSpecification);
    for (const name of Object.keys(modes)) map.setFilter(`leg-${name}`, legFilterFor(name));
    const dayFilter = active === null
      ? null
      : (['==', ['get', 'dayNumber'], active] as unknown as maplibregl.FilterSpecification);
    map.setFilter('leg-label', dayFilter);
    for (const id of ['stop-halo', 'stop-dot', 'stop-num']) map.setFilter(id, dayFilter);

    const pts = stops
      .filter((s) => active === null || s.day.dayNumber === active)
      .map((s) => [s.place.lon, s.place.lat] as [number, number]);
    fitTo(map, pts);
  }, [active, ready]);

  const flyTo = (p: Place) => {
    mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 15.5, speed: 1.1 });
  };

  const shown = active === null ? days : days.filter((d) => d.dayNumber === active);
  const legsByArrival = useMemo(() => {
    const m = new Map<string, Leg>();
    for (const l of legs) m.set(`${l.date}|${l.toId}|${l.arrive}`, l);
    return m;
  }, [legs]);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      {/* Sized, not positioned. MapLibre's stylesheet is unlayered and Tailwind's
          utilities are layered, so `.maplibregl-map { position: relative }` wins over
          any `absolute` utility here no matter the source order. */}
      <div ref={holder} className="h-full w-full" />

      <button
        onClick={() => setPanel((v) => !v)}
        className="absolute left-3 top-3 z-50 rounded-md border border-line bg-surface/90 px-3 py-2 text-xs
                   font-medium text-muted backdrop-blur transition hover:text-ink md:hidden"
      >
        {panel ? 'Hide plan' : 'Show plan'}
      </button>

      <aside
        className={`absolute left-0 top-0 z-40 flex h-full w-full max-w-[420px] flex-col
                    border-r border-line bg-bg/92 backdrop-blur-md transition-transform
                    duration-[280ms] ease-[var(--ease-out-hud)]
                    ${panel ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <header className="border-b border-line px-5 pb-4 pt-14 md:pt-5">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
            {trip.title ?? `${trip.city} trip`}
          </h1>
          <p className="tabular mt-1 text-sm text-muted">
            {fmt(trip.start)} to {fmt(trip.end)} &middot; {days.length} days &middot; {stops.length} stops
          </p>
          {!data.routed && (
            <p className="mt-2 rounded border border-line bg-raised px-2 py-1 text-[11px] text-faint">
              Travel times are straight-line estimates. Run <code className="font-[family-name:var(--font-mono)]">npm run routes</code> for road distances.
            </p>
          )}
        </header>

        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          <Chip on={active === null} onClick={() => setActive(null)} label="All" />
          {days.map((d) => (
            <Chip
              key={d.dayNumber}
              on={active === d.dayNumber}
              onClick={() => setActive(active === d.dayNumber ? null : d.dayNumber)}
              color={d.color}
              label={String(d.dayNumber)}
            />
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {shown.map((d) => (
            <section key={d.date} className="mb-6 last:mb-0">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="tabular grid h-6 w-6 place-items-center rounded-md text-[11px] font-bold text-bg"
                  style={{ background: d.color }}
                >
                  {d.dayNumber}
                </span>
                <div>
                  <div className="text-[13px] font-semibold">{d.weekday} {fmt(d.date)}</div>
                  {d.label && <div className="text-xs text-muted">{d.label}</div>}
                </div>
              </div>

              {d.items.length === 0 && <p className="pl-8 text-xs italic text-faint">Open.</p>}

              <ol className="ml-3 border-l border-line pl-5">
                {d.items.map((it, i) => {
                  const p = it.placeId ? byId.get(it.placeId) : undefined;
                  const leg = p ? legsByArrival.get(`${d.date}|${p.id}|${it.start}`) : undefined;
                  return (
                    <li key={i} className="relative py-2">
                      {leg && <LegRow leg={leg} modes={modes} />}
                      <span
                        className="absolute -left-[25px] top-3.5 h-2 w-2 rounded-full border-2 border-bg"
                        style={{ background: it.locked ? '#fafafa' : d.color }}
                      />
                      <button
                        onClick={() => p && flyTo(p)}
                        disabled={!p}
                        className="block w-full text-left disabled:cursor-default"
                      >
                        <span className="tabular text-[11px] text-faint">
                          {it.end ? `${it.start}-${it.end}` : it.start}
                        </span>
                        <span className="mt-0.5 flex items-baseline gap-1.5">
                          <span className={`text-[13px] ${p ? 'text-ink hover:text-cyan' : 'text-muted'} transition`}>
                            {p ? p.name : it.title}
                          </span>
                          {it.locked && (
                            <span className="rounded border border-muted px-1 text-[9px] uppercase tracking-wider text-ink">
                              yours
                            </span>
                          )}
                        </span>
                        {p?.neighbourhood && <span className="block text-[11px] text-faint">{p.neighbourhood}</span>}
                        {it.notes && <span className="mt-0.5 block text-xs leading-snug text-muted">{it.notes}</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>

        <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-5 py-3 text-[11px] text-faint">
          {Object.entries(modes).map(([name, spec]) => (
            <span key={name} className="flex items-center gap-1.5">
              <svg width="18" height="4" aria-hidden>
                <line x1="0" y1="2" x2="18" y2="2" stroke={spec.color} strokeWidth="2.5"
                      strokeDasharray={spec.dash ?? undefined} />
              </svg>
              {spec.label}
            </span>
          ))}
        </footer>
      </aside>
    </div>
  );
}

function LegRow({ leg, modes }: { leg: Leg; modes: TripData['modes'] }) {
  const spec = modes[leg.mode];
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-faint">
      <svg width="14" height="4" aria-hidden>
        <line x1="0" y1="2" x2="14" y2="2" stroke={spec?.color ?? '#71717a'} strokeWidth="2"
              strokeDasharray={spec?.dash ?? undefined} />
      </svg>
      <span className="tabular">
        {spec?.label ?? leg.mode} {leg.minutes} min &middot; {leg.km} km
        {!leg.routed && <span title="straight-line estimate"> approx</span>}
      </span>
    </div>
  );
}

function Chip({ on, onClick, label, color }: {
  on: boolean; onClick: () => void; label: string; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`tabular flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition
                  ${on ? 'border-ink text-ink' : 'border-line text-muted hover:border-faint hover:text-ink'}`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}

function esc(s: string) {
  return String(s ?? '').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
}

function fitTo(map: MLMap, pts: [number, number][]) {
  if (!pts.length) return;
  if (pts.length === 1) { map.easeTo({ center: pts[0], zoom: 14.5 }); return; }
  const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
  map.fitBounds(b, { padding: { top: 70, bottom: 70, left: 460, right: 70 }, maxZoom: 15.5, duration: 700 });
}

function legGeoJSON(legs: Leg[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: legs.map((l) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] },
      properties: {
        mode: l.mode, dayNumber: l.dayNumber, color: l.color,
        label: `${l.minutes} min`,
      },
    })),
  };
}

function stopGeoJSON(stops: { place: Place; day: Day; item: Item }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stops.map(({ place, day, item }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
      properties: {
        name: place.name, neighbourhood: place.neighbourhood ?? '',
        note: item.notes ?? place.notes ?? '',
        dayNumber: day.dayNumber, color: day.color,
        time: item.end ? `${item.start}-${item.end}` : item.start,
      },
    })),
  };
}
