#!/usr/bin/env node
// Fails loudly when personal data lands somewhere public.
//
// The rule this enforces: locations and times are publishable, every other
// personal detail is not. Addresses and exact coordinates are deliberately
// allowed, because a map rounded to the nearest half kilometre is useless. What
// must never ship is the other category entirely - contact details, booking and
// confirmation references, door codes, unit numbers, payment fragments.
//
//   node scripts/scan-personal.mjs            every git-tracked file
//   node scripts/scan-personal.mjs --staged   only what is staged (pre-commit)
//   node scripts/scan-personal.mjs --dist     tracked files plus the built site
//   node scripts/scan-personal.mjs --show     reveal the matched text
//
// Matches are REDACTED unless --show is passed. This repo is public, which
// makes its Actions logs public too, so a scanner that printed the secret it
// caught would be the leak it exists to prevent. Run it with --show locally.
import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const show = argv.includes('--show');
const staged = argv.includes('--staged');
const withDist = argv.includes('--dist');
// --message <file> scans a commit message instead of the tree. Added after a
// commit landed carrying a contact email in its SUBJECT LINE: the staged-file
// scan never sees the message, so that route was wide open. Commit messages are
// as public as the files on a public repo.
const msgPath = argv.includes('--message') ? argv[argv.indexOf('--message') + 1] : null;

// resources/ is gitignored and is the designated home for private data, so it
// is meant to hold exactly what this scanner hunts for. Never scan it.
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'resources', '.astro'];
// The scanner holds the patterns and the test holds deliberately fake secrets,
// so both would flag themselves forever.
const SKIP_FILES = ['package-lock.json', 'scripts/scan-personal.mjs', 'scripts/scan-personal.test.mjs'];
const SKIP_EXT = ['.woff2', '.woff', '.ttf', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gz'];

// Known-safe strings that would otherwise trip a rule. The Pages URL has to
// carry the GitHub username; that was a deliberate choice, not a leak.
const ALLOW = [
  /cpollreis\.github\.io/i,
  /CPollreis\/trip-mapper/i,
  /116454387\+CPollreis@users\.noreply\.github\.com/i,
  // Machine addresses that carry no personal information and legitimately
  // appear in commit trailers, which the --message mode scans.
  /noreply@github\.com/i,
  /noreply@anthropic\.com/i,
];

// Every real card number satisfies Luhn, so a failing run is not a card. Used
// as a rule validator rather than a separate pass, so the rule stays one unit.
function luhn(raw) {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const RULES = [
  { name: 'email address',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'phone number',
    re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g },
  // The code half is deliberately case-SENSITIVE and must contain a digit.
  // Matching case-insensitively made "Reservation required" and "booking"
  // drives" look like reference codes; a real locator is shaped like H4K2M9.
  { name: 'booking or confirmation reference',
    re: /(?:[Cc]onfirmation|[Bb]ooking|[Rr]eservation|[Ii]tinerary|[Rr]ecord locator|PNR)\b[^.\n]{0,24}?\b(?=[A-Z0-9]*\d)[A-Z0-9]{5,10}\b/g },
  { name: 'door, lockbox or entry code',
    re: /\b(?:door|lock ?box|gate|entry|keypad|access|buzzer|wifi|wi-fi)\s*(?:code|password|pin)\b[^.\n]{0,20}/gi },
  { name: 'unit or apartment number',
    re: /\b(?:apt|apartment|unit|suite|ste|buzzer|floor)\.?\s*#?\s*\d+[A-Za-z]?\b/gi },
  // Cards get pasted the way they are printed, in groups: "4111 1111 1111 1111"
  // and "4111-1111-1111-1111". An unbroken-run pattern missed both, which is
  // most of the real risk, so separators are matched and then stripped.
  //
  // Luhn does the deciding. Matching 13-19 loose digits alone would flag every
  // long number in a minified bundle; requiring the checksum to pass cuts the
  // false positives to roughly one in ten of those while keeping every genuine
  // card, because every card number is Luhn-valid by construction.
  //
  // Leading guard rejects a run preceded by a dot, killing the mantissa of a
  // minified constant: minifiers drop the leading zero, so they arrive as
  // `*.9933056200098587`. The trailing guard is only (?!\d), because rejecting
  // a following dot too would miss a card that ends a sentence.
  { name: 'payment card number',
    re: /(?<![\d.])\b\d(?:[ -]?\d){12,18}\b(?!\d)/g,
    validate: luhn },
  // The rest of a payment: a card number is not the only thing on a receipt,
  // and these are keyword-anchored so they cannot fire on minified vendor code.
  { name: 'card security code',
    re: /\b(?:cvv|cvc|cvv2|csc|security code)\b\s*(?:is|:|=)?\s*\d{3,4}\b/gi },
  { name: 'card expiry',
    re: /\b(?:exp|expiry|expires|valid thru|good thru)\.?\s*(?:date)?\s*(?:is|:|=)?\s*(?:0[1-9]|1[0-2])\s*[\/-]\s*\d{2,4}\b/gi },
  { name: 'card on file',
    re: /\b(?:visa|mastercard|amex|american express|discover|debit|credit card)\b[^.\n]{0,20}?\b(?:ending|ending in|last four|last 4|x{2,}|\*{2,})\s*\d{4}\b/gi },
  { name: 'bank account or routing number',
    re: /\b(?:account|acct|routing|transit|institution|sort code|swift|bic)\b\s*(?:no\.?|number|#)?\s*(?:is|:|=)?\s*\d{5,17}\b/gi },
  { name: 'iban',
    re: /\biban\b\s*(?:is|:|=)?\s*[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}/gi },
  { name: 'payment transfer detail',
    re: /\b(?:e-?transfer|interac|paypal|venmo|zelle|wise)\b[^.\n]{0,30}?(?:password|answer|security question|@|\d{4})/gi },
  // \b after the keyword, or "sin" matches the "singleTap" in minified vendor JS.
  { name: 'government id',
    re: /\b(?:passport|sin|ssn|licence|license)\b\s*(?:no\.?|number|#)?\s*[:=]?\s*[A-Z0-9]{6,}/gi },
  // Must START at a non-letter but may run on, so calebpollreis.com is caught
  // while the "caleB" buried in a minified scaleBy() is not.
  { name: 'personal name',
    re: /(?<![A-Za-z])(?:caleb|pollreis)/gi },
  // Asked for explicitly: this site must not read as part of the portfolio.
  { name: 'portfolio link',
    re: /calebpollreis\.com/gi },
];

function listFiles() {
  if (staged) {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  }
  const out = execSync('git ls-files', { encoding: 'utf8' });
  const tracked = out.split('\n').filter(Boolean);
  return withDist ? [...tracked, ...walk('dist')] : tracked;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIRS.includes(entry)) continue;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const skip = (f) =>
  SKIP_FILES.includes(f) ||
  SKIP_EXT.includes(extname(f)) ||
  SKIP_DIRS.some((d) => f === d || f.startsWith(`${d}/`));

const redact = (s) =>
  show ? s : s.length <= 4 ? '*'.repeat(s.length) : s.slice(0, 2) + '*'.repeat(Math.min(s.length - 2, 20));

// Exported so scan-personal.test.mjs can exercise the rules against fixtures
// without touching the filesystem.
export function scanText(text, file = '<text>') {
  const hits = [];
  const lines = text.split('\n');
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(rule.re)) {
        // Test the allowlist against a window around the hit, not the hit
        // itself: "pollreis" only looks safe once you can see the
        // cpollreis.github.io wrapped around it.
        const window = line.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
        if (ALLOW.some((a) => a.test(window))) continue;
        // A rule may add a second opinion, e.g. the card rule runs Luhn.
        if (rule.validate && !rule.validate(m[0])) continue;
        hits.push({ file, line: i + 1, rule: rule.name, match: m[0] });
      }
    });
  }
  return hits;
}

// Only scan and exit when run directly. The test file imports scanText, and a
// bare top-level process.exit() would kill the test run before it reported.
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain && msgPath) {
  // Comment lines are git's own template text, not part of the message.
  const body = readFileSync(msgPath, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  const hits = scanText(body, 'commit message');
  if (!hits.length) {
    console.log('scan-personal: commit message clean.');
    process.exit(0);
  }
  console.error(`scan-personal: ${hits.length} possible leak(s) in the commit message.\n`);
  for (const f of hits) console.error(`  line ${f.line}  [${f.rule}]  ${redact(f.match)}`);
  console.error('\nReword the message, then commit again.');
  process.exit(1);
}

if (isMain) {
  const findings = [];

  for (const file of listFiles()) {
    // dist/ is skipped as a directory by default, requested by --dist.
    if (skip(file) && !(withDist && file.startsWith('dist/'))) continue;
    if (!existsSync(file)) continue;
    if (SKIP_EXT.includes(extname(file))) continue;

    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue; // binary

    findings.push(...scanText(text, file));
  }

  const scope = staged ? 'staged files' : withDist ? 'tracked files and dist/' : 'tracked files';

  if (!findings.length) {
    console.log(`scan-personal: clean, no personal data found in ${scope}.`);
    process.exit(0);
  }

  console.error(`scan-personal: ${findings.length} possible leak(s) in ${scope}.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${redact(f.match)}`);
  }
  console.error(`\nMatches are redacted. Re-run locally with --show to see them.`);
  console.error('If a hit is a false positive, add it to ALLOW in scripts/scan-personal.mjs.');
  console.error('If it is real, move it to resources/private.json, which is gitignored.');
  process.exit(1);
}
