// OKLCH -> sRGB hex. Used so the 13 day colours are perceptually even in
// lightness; a naive HSL ramp makes the yellows glare and the blues go muddy.

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function oklchToRgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const gamma = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(clamp01(c), 1 / 2.4) - 0.055;

export function oklch(L, C, H) {
  const hex = oklchToRgb(L, C, H)
    .map((c) => Math.round(clamp01(gamma(c)) * 255))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

// Ramp reads as trip progression: warm at arrival, cool by departure.
// Adjacent days sit close together on purpose; the day number on each pin
// is what actually disambiguates them.
export function dayRamp(n) {
  if (n === 1) return [oklch(0.62, 0.16, 30)];
  return Array.from({ length: n }, (_, i) =>
    oklch(0.62, 0.16, 30 + (280 * i) / (n - 1))
  );
}
