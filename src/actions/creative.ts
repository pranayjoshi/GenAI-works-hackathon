/**
 * Ad creative generator: a deterministic, on-brand SVG for each variant (1080x1080 feed, 1080x1920 story).
 * Pure function of (business, place, handle, variant, text): same input, same SVG. No external assets or logos;
 * the illustration is drawn from plain vector shapes and chosen by business type (inferred from the name and post).
 */
export type Placement = 'feed' | 'story';
export interface CreativeInput { business: string; place?: string; handle?: string; variant: 'a' | 'b' | 'c'; text: string; placement?: Placement }
export type Kind = 'coffee' | 'gym' | 'bakery' | 'store';

/** Hues follow the UI tokens for A (blue) and B (orange); C is purple here (the UI's C token is teal). */
const HUES = {
  a: { dark: '#14246b', mid: '#2f6fed', light: '#8fb2ff', ink: '#0b1647' },
  b: { dark: '#6b2a07', mid: '#e66a1f', light: '#ffc08f', ink: '#3d1500' },
  c: { dark: '#3b1470', mid: '#8b5cf6', light: '#cdb6ff', ink: '#21093f' },
} as const;
const FONT = `'Bricolage Grotesque','Instrument Sans','Helvetica Neue',Helvetica,Arial,system-ui,sans-serif`;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function businessKind(business: string, text = ''): Kind {
  const t = `${business} ${text}`.toLowerCase();
  if (/\b(gym|fitness|crossfit|workout|yoga|pilates|training|barbell|membership)\b/.test(t)) return 'gym';
  if (/\b(bakery|bread|croissant|pastry|pastries|bake|baked|bagel|donut|sourdough)\b/.test(t)) return 'bakery';
  if (/\b(coffee|cafe|café|latte|espresso|roast|brew|tea|cappuccino|barista)\b/.test(t)) return 'coffee';
  return 'store';
}

export function parseOffer(text: string): string | null {
  const pct = text.match(/(\d{1,2})\s*%\s*off/i);
  if (pct) return `${pct[1]}% OFF`;
  const free = text.match(/\bfree\s+([a-z]+)/i);
  if (free) return `FREE ${free[1].toUpperCase()}`;
  const price = text.match(/\$\d+(?:\.\d{2})?/);
  return price ? price[0] : null;
}

/** Short headline (max 6 words) and a one-line subline from the post text. */
export function headlineOf(text: string): { headline: string; sub: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let first = (sentences[0] || clean).replace(/[.!?]+$/, '');
  if (first.includes(':')) first = first.split(':').slice(1).join(':').trim() || first;
  first = first.split(',')[0].replace(/^(new|introducing|try|meet)\s*[:,-]?\s+/i, '').replace(/^(our|your|the|a|an)\s+/i, '').trim();
  let words = first.split(' ').filter(Boolean);
  if (/^\$?\d/.test(first) || words.length < 2) words = (sentences[0] || clean).split(' ');
  const headline = words.slice(0, 6).join(' ').replace(/[,;:]+$/, '');
  const off = clean.match(/\d+\s*%\s*off[^.!,]*/i);
  const rest = sentences.slice(1).map((s) => s.replace(/[.!?]+$/, '')).filter((s) => !/^on the menu|^come say/i.test(s) && !/\$\d/.test(s) && !/% off/i.test(s));
  let sub = off ? off[0].replace(/^(\d+)\s*%\s*off/i, '').trim() : '';
  sub = sub ? sub : (rest[0] || '');
  if (off && /^this|^today|^all|^only/.test(sub)) sub = `${sub[0].toUpperCase()}${sub.slice(1)}`;
  else if (off) sub = off[0];
  if (sub.length > 44) sub = `${sub.slice(0, 41).trimEnd()}...`;
  return { headline, sub };
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = []; let cur = '';
  for (const w of text.split(' ')) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/** Illustrations are drawn around (0,0), roughly 460 px wide. */
function illustration(kind: Kind, hue: { dark: string; mid: string; light: string; ink: string }): string {
  const w = '#fffaf2', soft = 'rgba(255,255,255,.55)', sh = 'rgba(0,0,0,.18)';
  if (kind === 'coffee') return `
    <ellipse cx="0" cy="215" rx="230" ry="34" fill="${sh}"/>
    <ellipse cx="0" cy="190" rx="215" ry="32" fill="${w}"/><ellipse cx="0" cy="182" rx="170" ry="22" fill="#e9dfd0"/>
    <path d="M205 -70 C300 -80 300 70 190 90" fill="none" stroke="${w}" stroke-width="38" stroke-linecap="round"/>
    <path d="M-185 -110 H185 L150 150 Q140 190 100 190 H-100 Q-140 190 -150 150 Z" fill="${w}"/>
    <path d="M-170 -20 H170 L150 150 Q140 190 100 190 H-100 Q-140 190 -150 150 Z" fill="${hue.light}" opacity=".55"/>
    <ellipse cx="0" cy="-110" rx="185" ry="34" fill="#6b3f22"/><ellipse cx="0" cy="-112" rx="150" ry="24" fill="#c98a52"/>
    <path d="M0 -128 C-34 -118 -34 -100 0 -92 C34 -100 34 -118 0 -128Z" fill="#fff3df"/>
    <path d="M-60 -170 C-95 -215 -25 -245 -60 -300 M0 -180 C-35 -230 35 -265 0 -330 M60 -170 C25 -215 95 -245 60 -295" fill="none" stroke="${soft}" stroke-width="16" stroke-linecap="round"/>`;
  if (kind === 'gym') return `
    <ellipse cx="0" cy="170" rx="260" ry="26" fill="${sh}"/>
    <g transform="rotate(-18)">
      <rect x="-230" y="-22" width="460" height="44" rx="22" fill="#cfd5df"/>
      <rect x="-150" y="-26" width="300" height="52" rx="8" fill="#aab2c0"/>
      <rect x="-250" y="-120" width="64" height="240" rx="22" fill="${w}"/><rect x="-196" y="-90" width="52" height="180" rx="18" fill="#e9dfd0"/>
      <rect x="186" y="-120" width="64" height="240" rx="22" fill="${w}"/><rect x="144" y="-90" width="52" height="180" rx="18" fill="#e9dfd0"/>
      <rect x="-286" y="-70" width="36" height="140" rx="14" fill="${hue.light}"/><rect x="250" y="-70" width="36" height="140" rx="14" fill="${hue.light}"/>
    </g>`;
  if (kind === 'bakery') return `
    <ellipse cx="0" cy="190" rx="250" ry="30" fill="${sh}"/>
    <g fill="#e0a04a"><ellipse cx="-190" cy="95" rx="70" ry="48" transform="rotate(35 -190 95)"/><ellipse cx="190" cy="95" rx="70" ry="48" transform="rotate(-35 190 95)"/>
    <ellipse cx="-118" cy="20" rx="90" ry="62" transform="rotate(22 -118 20)"/><ellipse cx="118" cy="20" rx="90" ry="62" transform="rotate(-22 118 20)"/></g>
    <ellipse cx="0" cy="-10" rx="112" ry="92" fill="#eab35e"/>
    <g fill="none" stroke="#b46f23" stroke-width="9" stroke-linecap="round" opacity=".7"><path d="M-60 -70 Q-30 -10 -64 60"/><path d="M60 -70 Q30 -10 64 60"/><path d="M-150 -30 Q-120 20 -150 80"/><path d="M150 -30 Q120 20 150 80"/></g>
    <path d="M-60 -60 Q0 -110 60 -60" fill="none" stroke="#fff3df" stroke-width="12" stroke-linecap="round" opacity=".55"/>`;
  return `
    <ellipse cx="0" cy="215" rx="260" ry="28" fill="${sh}"/>
    <rect x="-220" y="-20" width="440" height="230" rx="10" fill="${w}"/>
    <path d="M-250 -30 L-215 -160 H215 L250 -30Z" fill="${hue.light}"/>
    <g>${[-4, -3, -2, -1, 0, 1, 2, 3].map((i) => `<path d="M${i * 62.5} -160 h62.5 l${i < 0 ? -4 : i > 0 ? 4 : 0} 130 h-62.5 z" fill="${i % 2 ? w : hue.mid}" opacity=".95"/>`).join('')}</g>
    <path d="M-250 -30 q31 36 62 0 q31 36 62 0 q31 36 62 0 q31 36 62 0 q31 36 62 0 q31 36 62 0 q31 36 62 0 q31 36 62 0Z" fill="${hue.mid}"/>
    <rect x="-170" y="40" width="190" height="110" rx="10" fill="${hue.light}" opacity=".6"/><rect x="50" y="30" width="120" height="180" rx="8" fill="${hue.dark}"/><circle cx="148" cy="125" r="8" fill="${w}"/>`;
}

export function renderCreative(inp: CreativeInput): string {
  const story = inp.placement === 'story';
  const W = 1080, H = story ? 1920 : 1080;
  const hue = HUES[inp.variant] ?? HUES.a;
  const kind = businessKind(inp.business, inp.text);
  const offer = parseOffer(inp.text);
  const { headline, sub } = headlineOf(inp.text);
  const size = headline.length > 26 ? 78 : 92;
  const lines = wrap(headline, size > 80 ? 16 : 19);
  const ty = story ? 1180 : 640, cy = story ? 640 : 320, scale = story ? 1.05 : 0.86;
  const lh = size * 1.08;
  const subY = ty + lines.length * lh + 14;
  const footY = story ? 1640 : H - 96;
  const initial = esc((inp.business.trim()[0] || 'R').toUpperCase());
  const place = esc((inp.place || '').replace(/,?\s*\d{5}$/, ''));
  const id = `g${inp.variant}${story ? 's' : 'f'}`;
  const badge = offer ? (() => {
    const big = offer.length > 8;
    const bx = story ? 850 : 860, by = story ? 300 : 190, r = 118;
    return `<g transform="translate(${bx} ${by}) rotate(10)"><circle r="${r + 10}" fill="rgba(0,0,0,.18)" transform="translate(0 8)"/><circle r="${r}" fill="#fffaf2"/><circle r="${r - 12}" fill="none" stroke="${hue.mid}" stroke-width="4" stroke-dasharray="3 11" stroke-linecap="round"/>
      <text text-anchor="middle" y="${big ? 14 : 20}" font-family="${FONT}" font-weight="800" font-size="${big ? 46 : offer.length > 5 ? 56 : 66}" fill="${hue.dark}">${esc(offer.replace(/ OFF$/, ''))}</text>${/ OFF$/.test(offer) ? `<text text-anchor="middle" y="60" font-family="${FONT}" font-weight="700" font-size="30" letter-spacing="4" fill="${hue.mid}">OFF</text>` : ''}</g>`;
  })() : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`${inp.business} ad: ${headline}`)}">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hue.mid}"/><stop offset="1" stop-color="${hue.dark}"/></linearGradient>
<radialGradient id="${id}r" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#${id})"/>
<circle cx="${W * 0.18}" cy="${cy + 40}" r="360" fill="${hue.light}" opacity=".16"/><circle cx="${W * 0.9}" cy="${H * 0.62}" r="260" fill="${hue.light}" opacity=".12"/>
<circle cx="${W / 2}" cy="${cy}" r="${story ? 400 : 330}" fill="url(#${id}r)"/>
<g transform="translate(${W / 2} ${cy}) scale(${scale})">${illustration(kind, hue)}</g>
${badge}
<g font-family="${FONT}" fill="#ffffff">
${lines.map((l, i) => `<text x="72" y="${ty + i * lh + size * 0.8}" font-size="${size}" font-weight="800" letter-spacing="-1.5">${esc(l)}</text>`).join('\n')}
${sub ? `<text x="72" y="${subY + 40}" font-size="40" font-weight="500" fill="${hue.light}">${esc(sub)}</text>` : ''}
<rect x="72" y="${footY - 62}" width="${W - 144}" height="2" fill="#fff" opacity=".22"/>
<circle cx="112" cy="${footY + 4}" r="34" fill="#fffaf2"/><text x="112" y="${footY + 18}" text-anchor="middle" font-size="40" font-weight="800" fill="${hue.dark}">${initial}</text>
<text x="168" y="${footY - 2}" font-size="38" font-weight="700">${esc(inp.business)}</text>
<text x="168" y="${footY + 34}" font-size="28" font-weight="500" opacity=".78">${place}</text>
<g transform="translate(${W - 72} ${footY - 20})"><rect x="-190" y="-28" width="190" height="62" rx="31" fill="#fffaf2"/><text x="-95" y="14" text-anchor="middle" font-size="28" font-weight="800" fill="${hue.ink}">Learn more</text></g>
</g>
</svg>`;
}

export const creativeUrl = (runId: string, variant: string, placement: Placement = 'feed', base = '') =>
  `${base}/api/runs/${encodeURIComponent(runId)}/creative/${variant.toLowerCase()}.svg${placement === 'story' ? '?placement=story' : ''}`;
