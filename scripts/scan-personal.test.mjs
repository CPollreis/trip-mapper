#!/usr/bin/env node
// Fixtures for the leak scanner. Run with: npm run test:scan
//
// Every MUST_CATCH case is a real shape of personal data that would be a leak
// on a public site. Every MUST_IGNORE case is something that actually tripped
// the scanner during development and is harmless - mostly minified maplibre
// internals, plus ordinary trip prose. Both halves matter equally: a scanner
// that cries wolf gets switched off, and one that stays quiet is decoration.
import { scanText } from './scan-personal.mjs';

const MUST_CATCH = [
  ['email', 'Host is host@example.com if anything goes wrong'],
  ['phone, dashed', 'Host cell 416-555-0142'],
  ['phone, spaced', 'Call +1 416 555 0142 on arrival'],
  ['booking reference', 'Booking ref H4K2M9 at the front desk'],
  ['confirmation code', 'Confirmation XR7T22 sent by email'],
  ['door code', 'Door code 4471 on the keypad'],
  ['lockbox code', 'Lockbox code is 8891'],
  ['wifi password', 'Wifi password hunter2 on the fridge'],
  ['unit number', 'Unit 1203, take the lift'],
  ['apartment number', 'Apt 4B, buzzer on the left'],
  // Financial data is the thing Caleb is most worried about, so these carry the
  // most weight. Numbers below are the standard public test cards, never real.
  ['card number mid-sentence', 'Card 4111111111111111 on file'],
  ['card number ending a sentence', 'Paid with card 4111111111111111.'],
  ['card number in spaced groups', 'Card 4111 1111 1111 1111 on file'],
  ['card number hyphenated', 'Card 4111-1111-1111-1111 on file'],
  ['visa 16 spaced', 'Paid 4012 8888 8888 1881 for the stay'],
  ['mastercard', 'Charged to 5555555555554444'],
  ['amex 15 spaced', 'Card 3782 822463 10005 on file'],
  ['discover', 'Card 6011111111111117'],
  ['cvv', 'CVV 123 on the back'],
  ['cvc with colon', 'cvc: 4567'],
  ['expiry slash', 'Card expires 09/28'],
  ['valid thru', 'Valid thru 12/2029'],
  ['card ending in', 'Visa ending 4242 was charged'],
  ['masked card', 'Mastercard xxxx 4444 on file'],
  ['account number', 'Account number 123456789'],
  ['routing number', 'Routing no. 021000021'],
  ['iban', 'IBAN GB82 WEST 1234 5698 7654 32'],
  ['e-transfer answer', 'E-transfer security question answer is toronto2026'],
  ['paypal', 'Paid via PayPal to host@example.com'],
  ['passport', 'Passport AB123456 for the border'],
  ['own name', 'Booked under Caleb'],
  ['own surname', 'Ask for Pollreis at reception'],
  ['name run together', 'Mirrors calebpollreis.com tokens'],
  ['portfolio domain', 'See https://calebpollreis.com for more'],
];

const MUST_IGNORE = [
  ['minified constant, no leading zero', 'this.ky=t*i*r*.9933056200098587}'],
  ['minified constant, bare dot', 'return e>.008856451679035631?e**(1/3)'],
  ['minified fov', 'this._fovInRadians=.6435011087932844,this._p'],
  ['pi mantissa', 'const x=3.141592653589793;'],
  ['singleTap handler', 'if(e.type==="singleTap"){this._t=0}'],
  ['scaleBy in minified js', 'function scaleBy(e,t){return e*t}'],
  ['the word booking in prose', 'Reservation required, book ahead online'],
  ['itinerary in prose', 'The itinerary colour is per day'],
  ['booking field in schema', '"booking": { "level": "required" }'],
  ['deploy url keeps the username', "site: 'https://cpollreis.github.io',"],
  ['repo slug', 'Deployed from CPollreis/trip-mapper on push'],
  ['github noreply', 'author 116454387+CPollreis@users.noreply.github.com'],
  ['street address is allowed', '565 Sherbourne St, Toronto, ON M4X 1W7'],
  ['exact coordinates are allowed', '"lat": 43.67024, "lon": -79.37566'],
  ['times are allowed', '"start": "15:00", "end": "17:00"'],
  ['dates are allowed', 'Sept 20-27. Sherbourne station, Line 2.'],
  ['hex colour', '"color": "#d55948"'],
  // Long numbers that are NOT cards. Each of these is 13-19 digits or looks
  // close, and each must stay quiet or the scanner becomes noise people mute.
  ['luhn-failing digit run', 'Ref 1234567890123456 is not a card'],
  ['iso timestamps in a row', 'Runs 2026-09-20 2026-10-02 daily'],
  ['flight time table', 'Legs 1450 1620 1755 1900 arrive'],
  ['osrm duration floats', '"carMin": 12.3, "roadKm": 1.92'],
  ['minified long int', 'const t=1789147879796;'],
  ['coordinates in a row', '43.67024,-79.37566 43.68593,-79.30592'],
];

let failed = 0;

for (const [label, text] of MUST_CATCH) {
  const hits = scanText(text);
  if (!hits.length) {
    console.error(`FAIL  should catch but missed: ${label}`);
    console.error(`        ${text}`);
    failed++;
  }
}

for (const [label, text] of MUST_IGNORE) {
  const hits = scanText(text);
  if (hits.length) {
    console.error(`FAIL  false positive: ${label}`);
    console.error(`        ${text}`);
    console.error(`        tripped: ${hits.map((h) => h.rule).join(', ')}`);
    failed++;
  }
}

const total = MUST_CATCH.length + MUST_IGNORE.length;
if (failed) {
  console.error(`\nscan-personal tests: ${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`scan-personal tests: ${total} passed (${MUST_CATCH.length} caught, ${MUST_IGNORE.length} ignored).`);
