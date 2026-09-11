// Shared trip-file resolution so build and dev always agree on which trip is meant.
import { readdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

export function listTrips(root) {
  const dir = new URL('trips/', root);
  // .routes.json files sit beside their trip and are generated, not trips.
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.routes.json')).sort()
    : [];
}

export function pickTrip(root, arg) {
  if (arg) return { path: arg, slug: basename(arg).replace(/\.json$/, '') };
  const files = listTrips(root);
  if (files.length === 1)
    return { path: `trips/${files[0]}`, slug: files[0].replace(/\.json$/, '') };
  if (!files.length) {
    console.error('No trips yet. Create one:');
    console.error('  npm run new-trip -- --city toronto --start 2026-09-20 --end 2026-10-02');
    process.exit(1);
  }
  console.error('Several trips exist, name one:');
  for (const f of files) console.error(`  npm run build -- trips/${f}`);
  process.exit(1);
}
