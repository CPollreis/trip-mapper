# The trip file

One file per trip, in `trips/`. Everything in `dist/<trip>/` is generated from
it, so edit here and run `npm run build`, or `npm run dev` to rebuild and reload
as you type. Nothing regenerates a trip file except `npm run new-trip`, which
refuses to overwrite.

## The `trip` block

```json
"trip": {
  "city": "Toronto",
  "citySlug": "toronto",
  "title": "Toronto Thirteen Days",
  "subtitle": "",
  "start": "2026-09-20",
  "end": "2026-10-02",
  "bookingNote": ""
}
```

| field | required | notes |
|---|---|---|
| `city` | yes | Display name. |
| `citySlug` | no | Which `cities/<slug>.json` to use for map geometry. Defaults to `city` lowercased. A missing file is fine; the map draws pins only. |
| `title` | no | Page heading and browser tab. Defaults to `<city> trip`. |
| `subtitle` | no | Overrides the generated line under the heading. |
| `start` / `end` | yes | Inclusive. Must match the `days` array. |
| `bookingNote` | no | Free text at the top of `reservations.md`, for pass rules and account details. |

## Two arrays that matter

`places[]` is the *what*: a venue, once, with its coordinates.
`days[].items[]` is the *when*: a slot on a given day that points at a place.

They are separate so a place you visit twice has one set of coordinates and one
Instagram source, referenced from two different time slots.

## places[]

```json
{
  "id": "sunnys-chinese",
  "name": "Sunny's Chinese",
  "category": "food",
  "neighbourhood": "Kensington Market",
  "lat": 43.6551,
  "lon": -79.4021,
  "address": "20 Kensington Ave, Toronto",
  "notes": "Cash only after 9pm",
  "source": {
    "type": "instagram",
    "url": "https://www.instagram.com/reel/ABC123/",
    "handle": "@someaccount",
    "caption_excerpt": "best cumin lamb in the city",
    "confidence": "confirmed"
  }
}
```

| field | required | notes |
|---|---|---|
| `id` | yes | kebab-case, unique. Referenced by `items[].placeId`. |
| `name` | yes | |
| `category` | yes | `food` `coffee` `bar` `sight` `activity` `shop` `outdoors` `lodging` `venue` `conference` |
| `lat` / `lon` | yes | Decimal degrees. Toronto is ~43.6, ~-79.4. Needed for the map. |
| `neighbourhood`, `address`, `notes` | no | |
| `source.confidence` | yes | See below. |

### `source.confidence`

The honest-labelling field. I cannot watch reel video, so every place is
identified from caption text, location tags, or hashtags.

- `confirmed`: the caption or location tag names the venue outright.
- `inferred`: I worked it out from context (handle, hashtags, visible signage
  in the thumbnail) and then verified the venue exists at that address.
- `unresolved`: the reel is real but I could not pin a venue. Coordinates are
  null, it does not appear on the map, and it lands in `dist/unresolved.md`
  for you to fill in.

Anything `inferred` is worth a glance before you build a day around it.

### Optional place fields

`"shortlist": true` marks a real venue you have not scheduled. It suppresses the
"not scheduled" warning and sends the place to `dist/shortlist.md` instead, which
is where to look when an evening opens up.

`"booking"` drives `dist/reservations.md`:

```json
"booking": { "level": "required", "how": "My CityPASS app. Timed entry." }
```

`level` is `required`, `recommended`, or `held` (already ticketed). The
checklist is ordered by the date you need the slot, not by when you booked it.

### Private overlay

`resources/private.json` is gitignored. Fields there replace the same fields on
the place with a matching id, applied after the trip file loads and before
validation. Use it for anything that should build locally but never be
committed: real addresses, exact coordinates, door codes.

```json
{ "places": { "<place id>": { "address": "...", "lat": 0, "lon": 0 } } }
```

An id that matches nothing warns and is skipped. A `source` object inside a
patch merges into the place's existing `source` rather than replacing it.

## days[].items[]

```json
{
  "start": "19:00",
  "end": "20:30",
  "placeId": "sunnys-chinese",
  "title": null,
  "type": "meal",
  "locked": false,
  "notes": ""
}
```

| field | required | notes |
|---|---|---|
| `start` | yes | 24h `HH:MM`, local Toronto time. |
| `end` | no | Omit for open-ended. |
| `placeId` | no* | Must match a `places[].id`. |
| `title` | no* | Free text, for items with no venue: "Flight lands YYZ", "train to Montreal". |
| `type` | yes | `meal` `coffee` `drinks` `activity` `sight` `outdoors` `transit` `fixed` `free` `lodging` `show` |
| `locked` | yes | **`true` = yours, hands off.** |
| `notes` | no | |

\* Need one of `placeId` or `title`. A `placeId` item inherits the place's name
and coordinates; `title` items are timeline-only and never hit the map.

## Adding your own events

Set `"locked": true`. The build treats locked items as immovable and plans
around them: they are never reordered, and if I later re-plan a day I fill the
gaps between them rather than replacing them. They render with a left rule in
the itinerary so it's obvious at a glance which items are yours and which are
suggestions.

```json
{ "start": "18:00", "end": "22:00", "title": "Dinner w/ Sam", "type": "fixed", "locked": true }
```

## Day fields

`label` is a short name for the day ("Kensington + west end"). `base` is the
neighbourhood you're anchored in, used to keep suggestions walkable. `color` is
the map/itinerary colour: it ramps warm-to-cool across the trip so the eye reads
progression. Overwrite it with any hex if you want.
