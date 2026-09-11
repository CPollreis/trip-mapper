#!/usr/bin/env node
// Refuses to build when private data is on disk.
//
// loadTrip() applies resources/private.json whenever it exists, so a local
// build bakes whatever is in that overlay into dist/. That output must never
// reach a public host. CI checks out a clean tree with no resources/, so this
// guard passes there and fails loudly anywhere else.
import { existsSync, readdirSync } from 'node:fs';

const offenders = [];

if (existsSync('resources')) {
  const files = readdirSync('resources').filter((f) => f !== '.gitkeep');
  if (files.length) offenders.push(...files.map((f) => `resources/${f}`));
}

if (offenders.length) {
  console.error('guard-public: refusing to build a public bundle.\n');
  console.error('These private files are present and would be baked into dist/:');
  for (const f of offenders) console.error(`  ${f}`);
  console.error('\nThe deploy workflow builds from a clean CI checkout, which has none of them.');
  console.error('To preview the public build locally, move resources/ aside first.');
  process.exit(1);
}

console.log('guard-public: no private files present, safe to build a public bundle.');
