# trip-mapper

Plan a trip in one JSON file. Generates a day-coded map, an itinerary, a booking
checklist and a Google My Maps import. No dependencies.

## How to use

```bash
npm run dev
```

Opens http://localhost:4173, rebuilds when you save, reloads the tab. Edit the
trip file in one window, watch the map change in the other.

| command | what it does |
|---|---|
| `npm run dev` | build, serve, watch, live reload |
| `npm run build` | build once into `dist/<trip>/` |
| `npm run trips` | list your trip files |
| `npm run new-trip -- --city <slug> --start <date> --end <date>` | start a new trip |

Add `-- trips/<file>.json` to any command when you have more than one trip, and
`-- --port 5000` to `dev` to move it off the default port.

**Start a trip**

```bash
npm run new-trip -- --city lisbon --start 2027-04-02 --end 2027-04-09
```

Writes `trips/lisbon-2027-04.json` with every day laid out and coloured. Then
fill in `places` and `days[].items`. Field reference is in `schema.md`.

**Mark your own fixed events** with `"locked": true` so the plan is built around
them rather than over them.

**A new city works right away.** The map draws your pins with no reference
geography behind them. To add coastline and transit lines, create
`cities/<slug>.json`; `cities/toronto.json` is the worked example.

**`resources/`** is for your own files: tickets, receipts, confirmations.
Everything you put there is gitignored and stays on your machine.

**Keep private details out of git** with `resources/private.json`. Fields there
replace the same fields on the matching place at build time, so the committed
trip file can hold a neighbourhood while your local build has the real address:

```json
{ "places": { "stay-01": {
    "name": "Stay: 12 Example St", "address": "12 Example St",
    "lat": 12.3456, "lon": -65.4321 } } }
```

Generated output lands in `dist/<trip>/` and is gitignored: `index.html`,
`mymaps.csv`, `itinerary.md`, `reservations.md`, `shortlist.md`, `unresolved.md`.
