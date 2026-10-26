import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const run = (engine: string) => execFileSync('npx', ['tsx', 'conformance/runner.ts'], { cwd: path.join(process.cwd(), 'engines', engine), encoding: 'utf8', timeout: 120_000 });

describe('Meterless engine conformance (vendored reference implementations)', () => {
  for (const e of ['hmem', 'markovian', 'world-model']) {
    it(`${e} passes its conformance runner`, () => {
      const out = run(e);
      expect(out).toMatch(/(\d+)\/\1 checks passed/);
    }, 120_000);
  }
});
