import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import type { TripData, Leg, Place, Day, Item, Advice, Spare } from './types';

// CARTO's dark basemap. Free, no key, and already the right value range for
// the portfolio's palette, so the trip data stays the only saturated thing
// on screen.
const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const fmt = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA',
    { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function TripApp({ data }: { data: TripData }) {
  const { trip, places, days, legs, spare, modes, advice } = data;
  const mapRef = useRef<MLMap | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState(true);
  const [tab, setTab] = useState<'plan' | 'tips'>('plan');

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
      map.addSource('spare', { type: 'geojson', data: spareGeoJSON(spare, null) });

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

      // Unscheduled options. Every hue in the ramp belongs to a day, so these
      // are told apart by weight instead: an unfilled ring, no numeral, and no
      // saturation. Added before the stop layers so a planned pin always draws
      // on top of an option sitting at the same address.
      map.addLayer({
        id: 'spare-ring',
        type: 'circle',
        source: 'spare',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 6, 17, 8],
          'circle-color': '#09090b',
          'circle-opacity': ['case', ['get', 'near'], 0.55, 0.2],
          'circle-stroke-color': '#d4d4d8',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 1.5, 17, 2],
          'circle-stroke-opacity': ['case', ['get', 'near'], 0.95, 0.22],
        },
      });
      map.addLayer({
        id: 'spare-label',
        type: 'symbol',
        source: 'spare',
        minzoom: 12.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#d4d4d8',
          'text-halo-color': '#09090b',
          'text-halo-width': 1.4,
          'text-opacity': ['case', ['get', 'near'], 0.95, 0.25],
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
               ${p.tip ? `<div style="font-size:12px;color:#a1a1aa;margin-top:6px;padding-top:6px;border-top:1px solid #27272a">${esc(p.tip)}</div>` : ''}
             </div>`)
          .addTo(map);
      });
      map.on('click', 'spare-ring', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        new maplibregl.Popup({ offset: 12, closeButton: true })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div style="font-family:var(--font-sans);max-width:240px">
               <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#d4d4d8">
                 Unscheduled${p.category ? ` &middot; ${esc(p.category)}` : ''}</div>
               <div style="font-weight:600;margin-top:3px">${esc(p.name)}</div>
               ${p.neighbourhood ? `<div style="font-size:12px;color:#a1a1aa">${esc(p.neighbourhood)}</div>` : ''}
               ${p.tip ? `<div style="font-size:12px;color:#a1a1aa;margin-top:6px">${esc(p.tip)}</div>` : ''}
               <div style="font-size:12px;color:#a1a1aa;margin-top:6px;padding-top:6px;border-top:1px solid #27272a">
                 ${p.walkable ? `A walk from ${esc(p.walkable)}` : 'No day passes within walking distance'}</div>
             </div>`)
          .addTo(map);
      });
      for (const id of ['stop-dot', 'stop-halo', 'spare-ring']) {
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
    // Unscheduled pins are never filtered out, only dimmed: the point of them is
    // to be visible when a day runs short, including the ones you would have to
    // travel for.
    (map.getSource('spare') as maplibregl.GeoJSONSource)?.setData(spareGeoJSON(spare, active));

    const pts = stops
      .filter((s) => active === null || s.day.dayNumber === active)
      .map((s) => [s.place.lon, s.place.lat] as [number, number]);
    fitTo(map, pts);
  }, [active, ready]);

  const flyTo = (p: Place) => {
    mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 15.5, speed: 1.1 });
  };

  const shown = active === null ? days : days.filter((d) => d.dayNumber === active);

  // Travel time per day. Legs cover stop-to-stop hops; title-only transit items
  // (the Niagara coach, the UP Express runs) have no place and so no leg, so
  // their own duration is added from the clock.
  const travelByDate = useMemo(() => {
    const m = new Map<string, { min: number; km: number }>();
    for (const l of legs) {
      const cur = m.get(l.date) ?? { min: 0, km: 0 };
      m.set(l.date, { min: cur.min + l.minutes, km: cur.km + l.km });
    }
    for (const day of days)
      for (const it of day.items) {
        // A mode marks a real journey; the locked checkout blocks are typed
        // transit but carry none, and legs already cover stop-to-stop hops.
        if (it.type !== 'transit' || it.placeId || !it.end || !it.mode) continue;
        const mins = span(it.start, it.end);
        if (mins == null) continue;
        const cur = m.get(day.date) ?? { min: 0, km: 0 };
        m.set(day.date, { min: cur.min + mins, km: cur.km });
      }
    return m;
  }, [legs, days]);
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

        <div className="flex gap-4 border-b border-line px-5">
          {(['plan', 'tips'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-selected={tab === t}
              className={`-mb-px border-b-2 py-2.5 text-xs font-medium capitalize transition
                          ${tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {t === 'plan' ? 'Day plan' : `Toronto tips (${advice.length})`}
            </button>
          ))}
        </div>

        {tab === 'plan' && (
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
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'tips' && <Tips advice={advice} />}
          {tab === 'plan' && shown.map((d) => (
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
                  {travelByDate.get(d.date) && (
                    <div className="tabular text-[11px] text-faint">
                      {hm(travelByDate.get(d.date)!.min)} travelling
                      {travelByDate.get(d.date)!.km > 0 &&
                        ` \u00b7 ${Math.round(travelByDate.get(d.date)!.km)} km`}
                    </div>
                  )}
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
          <span className="flex items-center gap-1.5">
            <svg width="18" height="10" aria-hidden>
              <circle cx="9" cy="5" r="3.5" fill="#09090b" stroke="#d4d4d8" strokeWidth="1.5" />
            </svg>
            Unscheduled ({spare.length})
          </span>
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

function Tips({ advice }: { advice: Advice[] }) {
  if (!advice.length)
    return <p className="text-xs italic text-faint">No general tips recorded yet.</p>;
  const tags = [...new Set(advice.map((a) => a.tag))];
  return (
    <div>
      {tags.map((tag) => (
        <section key={tag} className="mb-6 last:mb-0">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{tag}</h2>
          <ul className="space-y-3">
            {advice.filter((a) => a.tag === tag).map((a) => (
              <li key={a.title} className="border-l border-line pl-3">
                <div className="text-[13px] font-semibold text-ink">{a.title}</div>
                <p className="mt-0.5 text-xs leading-snug text-muted">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
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

// Minutes between two HH:MM stamps on the same day, or null if unparseable.
function span(a: string, b: string) {
  const m = (t: string) => {
    const r = /^(\d{2}):(\d{2})$/.exec(t || '');
    return r ? +r[1] * 60 + +r[2] : null;
  };
  const s = m(a), e = m(b);
  return s == null || e == null || e <= s ? null : e - s;
}

function hm(min: number) {
  const h = Math.floor(min / 60), r = min % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
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

// `near` is what the paint expressions dim on. With no day selected everything
// reads at full strength; with one selected, only what you could walk to from
// that day's route does.
function spareGeoJSON(spare: Spare[], active: number | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: spare.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        name: p.name,
        category: p.category ?? '',
        neighbourhood: p.neighbourhood ?? '',
        tip: p.notes ?? '',
        near: active === null || p.nearDays.includes(active),
        walkable: p.nearDays.length
          ? `day${p.nearDays.length > 1 ? 's' : ''} ${p.nearDays.join(', ')}`
          : '',
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
        note: item.notes ?? '',
        tip: place.notes ?? '',
        dayNumber: day.dayNumber, color: day.color,
        time: item.end ? `${item.start}-${item.end}` : item.start,
      },
    })),
  };
}
