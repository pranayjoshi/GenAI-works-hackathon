import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type Role = 'crowd' | 'reason' | 'review' | 'interview' | 'voice';
export type ProviderName = 'nightshift' | 'nvidia' | 'ollama';

const env = (k: string, d = '') => process.env[k] ?? d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

function nightshiftToken(): string {
  if (env('NIGHTSHIFT_TOKEN')) return env('NIGHTSHIFT_TOKEN');
  const candidates = [
    env('NIGHTSHIFT_STATE_DIR') && path.join(env('NIGHTSHIFT_STATE_DIR'), 'proxy-token'),
    path.join(os.homedir(), 'Library/Application Support/Nightshift/proxy-token'),
    path.join(os.homedir(), '.nightshift/proxy-token'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try { return fs.readFileSync(c, 'utf8').trim(); } catch { /* not present */ }
  }
  return '';
}

/** Hosted Nemotron ids (NVIDIA catalog, confirmed 26 Oct 2026) and local Ollama Nemotron tags. */
const HOSTED: Record<Role, string> = {
  crowd: env('MODEL_CROWD', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
  voice: env('MODEL_VOICE', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
  reason: env('MODEL_REASON', 'nvidia/nemotron-3-super-120b-a12b'),
  interview: env('MODEL_INTERVIEW', 'nvidia/nemotron-3-super-120b-a12b'),
  review: env('MODEL_REVIEW', 'nvidia/nemotron-3-ultra-550b-a55b'),
};
const LOCAL: Record<Role, string> = {
  crowd: env('OLLAMA_MODEL_CROWD', 'nemotron-3-nano:4b'),
  voice: env('OLLAMA_MODEL_VOICE', 'nemotron-3-nano:4b'),
  reason: env('OLLAMA_MODEL_REASON', 'nemotron-3-nano:4b'),
  interview: env('OLLAMA_MODEL_INTERVIEW', 'nemotron-3-nano:4b'),
  review: env('OLLAMA_MODEL_REVIEW', 'nemotron-3-nano:4b'),
};
/** Which roles reason with thinking on (BUILD_PLAN §8). */
export const THINKING: Record<Role, boolean> = {
  crowd: false, voice: false, interview: false, reason: true, review: true,
};

export const config = {
  root: process.cwd(),
  port: num('PORT', 8787),
  sampleMode: env('SAMPLE_MODE', 'false') === 'true',
  sampleStrict: env('SAMPLE_STRICT', 'false') === 'true', // replay misses fail instead of calling a live provider
  record: env('RECORD', 'true') !== 'false',
  replayCrowdMs: num('REPLAY_CROWD_MS', 450),   // pacing per crowd call in SAMPLE_MODE so replays look live
  providers: (env('PROVIDERS', 'nightshift,nvidia,ollama').split(',').map((s) => s.trim()).filter(Boolean)) as ProviderName[],
  nightshift: {
    baseUrl: env('NIGHTSHIFT_BASE_URL', 'http://127.0.0.1:8088/v1'),
    token: nightshiftToken(),
    app: env('NIGHTSHIFT_APP', 'dryrun'),
    models: HOSTED,
    concurrency: num('NIGHTSHIFT_CONCURRENCY', 8),
  },
  nvidia: {
    baseUrl: env('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
    apiKey: env('NVIDIA_API_KEY'),
    models: HOSTED,
    concurrency: num('NVIDIA_CONCURRENCY', 6),
    rpm: num('NVIDIA_RPM', 38),
  },
  ollama: {
    baseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    models: LOCAL,
    concurrency: num('OLLAMA_CONCURRENCY', 3),
    thinking: env('OLLAMA_THINKING', 'false') === 'true',
  },
  zetaris: {
    baseUrl: env('ZETARIS_BASE_URL'), // e.g. http://localhost:3000/api/proxy or https://<host>/api/v1.0
    user: env('ZETARIS_USER'),
    password: env('ZETARIS_PASSWORD'),
    apiKey: env('ZETARIS_API_KEY'),
    orgId: env('ZETARIS_ORG_ID'),
    openPath: env('ZETARIS_OPEN_PATH', '/sql/open'),
    pagePath: env('ZETARIS_PAGE_PATH', '/sql/page'),
    closePath: env('ZETARIS_CLOSE_PATH', '/sql/close'),
  },
  censusReporter: env('CENSUS_REPORTER_URL', 'https://api.censusreporter.org/1.0'),
  paths: {
    data: path.join(process.cwd(), 'data'),
    runs: path.join(process.cwd(), 'runs'),
    samples: path.join(process.cwd(), 'samples'),
    recordings: path.join(process.cwd(), 'samples', 'recordings.sqlite'),
  },
};

export function zetarisConfigured() {
  return Boolean(config.zetaris.baseUrl && (config.zetaris.apiKey || config.zetaris.user));
}
