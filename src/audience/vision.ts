/**
 * VisionAgent: turns an uploaded image into a short factual description the crowd reads as "[image: ...]".
 * Images are real inputs: the bytes go to a vision-capable Nemotron model over the NVIDIA route
 * (nemotron-3.5-super-vl-120b-a12b first, nemotron-3-nano-omni-30b-a3b-reasoning if that fails), thinking off.
 * Results are cached by image hash (data/cache/vision/), so a rerun or the second world never calls twice.
 * If no model can see the image, the description says so; nothing is invented.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { chat } from '../llm.js';
import { config } from '../config.js';
import { agentLog } from '../util/agentlog.js';
import { sha } from '../util/core.js';

const IMG_DIR = path.join(config.paths.data, 'cache', 'images');
const DESC_DIR = path.join(config.paths.data, 'cache', 'vision');
const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
export const VISION_MODELS = [
  process.env.MODEL_VISION || 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  process.env.MODEL_VISION_FALLBACK || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
];

const Description = z.object({ description: z.string().min(5) });

export interface StoredImage { id: string; mime: string; file: string }
export interface ImageDescription { id: string; description: string; model: string; served_by: string; cached: boolean; fallback: boolean }

/** Stable id of an image reference (data URL or https URL); no I/O. */
export const imageId = (ref: string) => sha(ref, 12);

/** Save the bytes of a data URL or https URL under data/cache/images/<id>.<ext>. */
export async function storeImage(ref: string): Promise<StoredImage> {
  const id = imageId(ref);
  let mime: string, buf: Buffer;
  const m = ref.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  if (m) { mime = m[1].toLowerCase(); buf = Buffer.from(m[2], 'base64'); }
  else if (/^https?:\/\//i.test(ref)) {
    const res = await fetch(ref, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`image URL answered HTTP ${res.status}`);
    mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || MIME[path.extname(new URL(ref).pathname).slice(1).toLowerCase()] || '';
    buf = Buffer.from(await res.arrayBuffer());
  } else throw new Error('image must be a data URL (data:image/...;base64,...) or an https URL');
  if (!EXT[mime]) throw new Error(`unsupported image type "${mime || 'unknown'}" (use PNG, JPEG, WebP, GIF or SVG)`);
  if (buf.length > MAX_BYTES) throw new Error('image is larger than 8 MB');
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const file = path.join(IMG_DIR, `${id}.${EXT[mime]}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return { id, mime, file };
}

/** Stored image for an id, if present (used to serve thumbnails and the ad mockup). */
export function findImage(id: string): StoredImage | null {
  if (!/^[a-f0-9]{12}$/.test(id) || !fs.existsSync(IMG_DIR)) return null;
  const f = fs.readdirSync(IMG_DIR).find((x) => x.startsWith(`${id}.`));
  return f ? { id, mime: MIME[path.extname(f).slice(1)], file: path.join(IMG_DIR, f) } : null;
}

/** Text that is literally in an SVG (vision models cannot read SVG). */
function svgFacts(svg: string): string {
  const label = svg.match(/aria-label="([^"]*)"/)?.[1];
  const texts = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((x) => x[1].trim()).filter(Boolean);
  return [label ? `${label}.` : '', texts.length ? `Text in the image: ${texts.join(' | ')}` : ''].filter(Boolean).join(' ');
}

const SYSTEM = `You describe an image that will appear inside a social media post, for people who cannot see it.
Write 2 to 3 plain sentences, under 70 words. Cover only what is visible: what is shown, any text written in the image (quote it exactly), the mood, the main colours, and any offer or price that is printed in it.
Never guess the brand's claims, never add details that are not visible, never describe people's race, ethnicity, gender, age or nationality.`;

export async function describeImage(ref: string, ctx: { run_id?: string; label?: string; business?: string } = {}): Promise<ImageDescription> {
  const t0 = Date.now();
  const img = await storeImage(ref);
  const cacheFile = path.join(DESC_DIR, `${img.id}.json`);
  const log = (status: 'success' | 'fallback' | 'error', d: ImageDescription, extra = '') => agentLog({
    run_id: ctx.run_id, agent_name: 'VisionAgent', action: 'describe_image', target_agent: 'CrowdAgent', status, model: d.model, served_by: d.served_by, ms: Date.now() - t0,
    input_summary: `${ctx.label ?? 'image'} ${img.id} (${img.mime})${d.cached ? ' [cache]' : ''}`, output_summary: `${d.description.slice(0, 220)}${extra}`, refs: { image_id: img.id, cached: d.cached },
  });
  try {
    const hit = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as ImageDescription;
    const d = { ...hit, cached: true };
    log(d.fallback ? 'fallback' : 'success', d);
    return d;
  } catch { /* not cached */ }

  let out: ImageDescription;
  if (img.mime === 'image/svg+xml') {
    const facts = svgFacts(fs.readFileSync(img.file, 'utf8'));
    out = { id: img.id, description: facts || 'An illustration (vector image) with no readable text.', model: 'svg-text', served_by: 'rules:svg-text', cached: false, fallback: true };
    log('fallback', out, '; SVG cannot be sent to a vision model, text read from the file');
  } else {
    const dataUrl = `data:${img.mime};base64,${fs.readFileSync(img.file).toString('base64')}`;
    let got: ImageDescription | null = null;
    const errs: string[] = [];
    for (const model of VISION_MODELS) {
      try {
        const r = await chat({
          role: 'reason', model, providers: ['nightshift'], thinking: false, images: [dataUrl], system: SYSTEM,
          user: `Describe this image${ctx.business ? ` from ${ctx.business}'s post` : ''}. Return {"description": "..."}.`,
          schema: Description, schemaName: 'ImageDescription', tag: ctx.run_id ?? 'vision', maxTokens: 300, temperature: 0.2,
        });
        if (r.ok && r.data) { got = { id: img.id, description: r.data.description.trim().replace(/\s+/g, ' '), model: r.model, served_by: r.served_by, cached: false, fallback: false }; break; }
        errs.push(`${model}: reply not valid`);
      } catch (e) { errs.push(`${model}: ${(e as Error).message.slice(0, 120)}`); }
    }
    if (got) { out = got; log('success', out, errs.length ? `; first model failed (${errs[0]})` : ''); }
    else {
      out = { id: img.id, description: 'An image is attached, but it could not be described.', model: '-', served_by: 'none', cached: false, fallback: true };
      log('error', out, `; ${errs.join(' | ')}`);
      return out; // not cached: a later run may succeed
    }
  }
  try { fs.mkdirSync(DESC_DIR, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(out)); } catch { /* cache is best effort */ }
  return out;
}
