import { describe, it, expect } from 'vitest';
import { RunBody, toRunInput, redactImages } from '../src/runApi.js';
import { specFromInput } from '../src/sim/run.js';
import { describeImage, imageId } from '../src/audience/vision.js';

const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" aria-label="Test banner"><text>20% OFF today</text></svg>').toString('base64');
const base = { business: { name: 'Cafe', zip: '78704' } };

describe('versions beyond post text', () => {
  it('defaults stay instagram text posts', () => {
    const b = RunBody.parse({ ...base, version_a: { text: 'Oat latte $6.50' }, version_b: { text: 'Morning ritual 20% off' } });
    expect(b.platform).toBe('instagram');
    const spec = specFromInput(toRunInput(b), 'r1');
    expect(spec.posts[0]).toEqual({ variant: 'A', text: 'Oat latte $6.50', business: 'Cafe', handle: '@cafe' });
  });
  it('maps image, ad and campaign versions', () => {
    const b = RunBody.parse({
      ...base, platform: 'tiktok',
      version_a: { type: 'image', image: svg, caption: 'New banner' },
      version_b: { type: 'ad', headline: 'Fresh daily', primary_text: 'Bread at 6am', cta: 'Order now' },
    });
    const inp = toRunInput(b);
    const spec = specFromInput(inp, 'r2');
    expect(spec.platform).toBe('tiktok');
    expect(spec.posts[0].kind).toBe('image');
    expect(spec.posts[0].image_id).toBe(imageId(svg));
    expect(spec.posts[1].text).toBe('Fresh daily. Bread at 6am [Button: Order now]');
    const c = RunBody.parse({ ...base, version_a: { posts: [{ text: 'Teaser one' }, { text: 'Offer two' }, { text: 'Last call three' }] }, version_b: { text: 'Plain post' } });
    const cs = specFromInput(toRunInput(c), 'r3');
    expect(cs.posts[0].items).toHaveLength(3);
    expect(cs.posts[0].kind).toBe('campaign');
  });
  it('rejects bad shapes and redacts base64 in the echo', () => {
    expect(RunBody.safeParse({ ...base, version_a: { type: 'image' }, version_b: { text: 'abc' } }).success).toBe(false);
    expect(RunBody.safeParse({ ...base, platform: 'linkedin', version_a: { text: 'abc' }, version_b: { text: 'abc' } }).success).toBe(false);
    expect(RunBody.safeParse({ ...base, version_a: { posts: [{ text: 'only one' }] }, version_b: { text: 'abc' } }).success).toBe(false);
    expect(JSON.stringify(redactImages({ image: svg }))).not.toContain('base64,PHN2');
  });
  it('describes an SVG from its own text without a model call', async () => {
    const d = await describeImage(svg, { label: 'test' });
    expect(d.description).toContain('20% OFF today');
    expect(d.fallback).toBe(true);
  });
});
