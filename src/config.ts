import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type Role = 'crowd' | 'reason' | 'review' | 'interview' | 'voice';
export type ProviderName = 'nightshift' | 'nvidia' | 'ollama';

const env = (k: string, d = '') => process.env[k] ?? d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
/** First non-empty of several names, so the hackathon guide's METERLESS_* and ZETARIS_REST_URL names work too. */
const envAny = (keys: string[], d = '') => keys.map((k) => process.env[k]).find(Boolean) ?? d;

function nightshiftToken(): string {
  const token = envAny(['NIGHTSHIFT_TOKEN', 'METERLESS_RUNTIME_TOKEN']);
  if (token) return token;
  const candidates = [
    env('METERLESS_TOKEN_FILE'),
    env('NIGHTSHIFT_STATE_DIR') && path.join(env('NIGHTSHIFT_STATE_DIR'), 'proxy-token'),
    path.join(os.homedir(), 'Library/Application Support/ai.meterless.runtime/proxy-token'), // macOS
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ai.meterless.runtime', 'proxy-token'), // Windows
    path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ai.meterless.runtime', 'proxy-token'), // Linux
    path.join(os.homedir(), '.config', 'ai.meterless.runtime', 'proxy-token'),
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
  reason: env('MODEL_REASON', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
  interview: env('MODEL_INTERVIEW', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
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
  replayCrowdMs: num('REPLAY_CROWD_MS', 450),
  crowdPrompt: env('CROWD_PROMPT', 'v1') as 'v1' | 'v2',   // pacing per crowd call in SAMPLE_MODE so replays look live
  providers: (env('PROVIDERS', 'nightshift,nvidia,ollama').split(',').map((s) => s.trim()).filter(Boolean)) as ProviderName[],
  nightshift: {
    baseUrl: envAny(['NIGHTSHIFT_BASE_URL', 'METERLESS_BASE_URL'], 'http://127.0.0.1:8088/v1'),
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
  // Meta Ads (launch action). Sandbox ad account recommended; every object is created paused (docs/META_SETUP.md)
  meta: {
    accessToken: env('META_ACCESS_TOKEN'),
    adAccountId: env('META_AD_ACCOUNT_ID'),
    pageId: env('META_PAGE_ID'),
    instagramUserId: env('META_INSTAGRAM_USER_ID'),
    linkUrl: env('META_LINK_URL', 'https://example.com'),
    apiVersion: env('META_API_VERSION', 'v23.0'),
    graphUrl: env('META_GRAPH_URL', 'https://graph.facebook.com'),
    dailyBudgetCents: num('META_DAILY_BUDGET_CENTS', 500),
  },
  zetaris: {
    // ZETARIS_REST_URL (guide style, ends in /api/v1.0) is accepted and trimmed to the host
    baseUrl: env('ZETARIS_BASE_URL') || env('ZETARIS_REST_URL').replace(/\/api\/v1\.0\/?$/, ''), // e.g. https://api.saas.enterprise.zetaris.com or a local Docker host
    user: env('ZETARIS_USER'),
    password: env('ZETARIS_PASSWORD'),
    apiKey: env('ZETARIS_API_KEY'),
    orgId: env('ZETARIS_ORG_ID', '1'), // the local bundle's default org
    openPath: env('ZETARIS_OPEN_PATH', '/api/v1.0/query/sql/start'),
    pagePath: env('ZETARIS_PAGE_PATH', '/api/v1.0/query/sql/page'),
    closePath: env('ZETARIS_CLOSE_PATH', '/api/v1.0/query/sql/close'),
    fileRoot: env('ZETARIS_FILE_ROOT'), // where Zetaris sees this project's files, e.g. /home/zetaris/customer-data/shared/dryrun in a Docker volume
  },
  censusReporter: env('CENSUS_REPORTER_URL', 'https://api.censusreporter.org/1.0'),
  paths: {
    data: path.join(process.cwd(), 'data'),
    runs: env('RUNS_DIR', path.join(process.cwd(), 'runs')),
    samples: path.join(process.cwd(), 'samples'),
    recordings: env('RECORDINGS_DB', path.join(process.cwd(), 'samples', 'recordings.sqlite')),
  },
};

export function zetarisConfigured() {
  return Boolean(config.zetaris.baseUrl && (config.zetaris.apiKey || config.zetaris.user));
}
