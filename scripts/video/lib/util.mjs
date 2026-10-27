// Shared helpers for the video pipeline.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MEDIA = path.join(ROOT, 'media');
export const SCENES = path.join(ROOT, 'scripts/video/scenes');

/** Playwright lives in media/tools (its own package.json), not in the project's dependencies. */
export async function playwright() {
  return import(path.join(MEDIA, 'tools/node_modules/playwright/index.mjs'));
}

export function probeDuration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

export function ff(args, opts = {}) {
  return execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: opts.quiet === false ? 'inherit' : ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 26 });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
