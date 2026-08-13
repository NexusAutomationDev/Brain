import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// SEED-01/Pitfall 3: proves that no brain type's seed SQL or Dockerfile ever references
// another brain_type's seed content or seed path. Pure real-file reads (no mocks), same
// convention as SEED-05's block in seed.test.ts and migration-v14.test.ts.

const SEEDS_DIR = join(import.meta.dir, '../../seeds');
const REPO_ROOT = join(import.meta.dir, '../../../../..');

const BRAIN_TYPES = ['sdr', 'support', 'echo'] as const;

function seedFilePath(brainType: string): string {
  return join(SEEDS_DIR, brainType, '0001_fup_defaults.sql');
}

function dockerfilePath(brainType: string): string {
  return join(REPO_ROOT, 'apps', `brain-${brainType}`, 'Dockerfile');
}

describe('Seed cross-brain isolation (SEED-01, Pitfall 3) — seed SQL content', () => {
  const contents: Record<string, string> = {};
  for (const brainType of BRAIN_TYPES) {
    contents[brainType] = readFileSync(seedFilePath(brainType), 'utf-8');
  }

  // 6 ordered pairs across sdr/support/echo — each brain type's seed file text must never
  // contain another brain type's brain_type literal in single-quoted form.
  for (const a of BRAIN_TYPES) {
    for (const b of BRAIN_TYPES) {
      if (a === b) continue;
      it(`seeds/${a}/0001_fup_defaults.sql does not contain '${b}' brain_type literal`, () => {
        expect(contents[a]).not.toContain(`'${b}'`);
      });
    }
  }

  it('each seed file contains only its own brain_type literal', () => {
    for (const brainType of BRAIN_TYPES) {
      expect(contents[brainType]).toContain(`'${brainType}'`);
    }
  });
});

describe('Seed cross-brain isolation (SEED-01, Pitfall 3) — Dockerfile physical separation', () => {
  const dockerfiles: Record<string, string> = {};
  for (const brainType of BRAIN_TYPES) {
    const path = dockerfilePath(brainType);
    expect(existsSync(path)).toBe(true);
    dockerfiles[brainType] = readFileSync(path, 'utf-8');
  }

  for (const brainType of BRAIN_TYPES) {
    it(`apps/brain-${brainType}/Dockerfile references seeds/${brainType} exactly once`, () => {
      const matches = dockerfiles[brainType].match(new RegExp(`seeds/${brainType}\\b`, 'g')) ?? [];
      expect(matches.length).toBe(1);
    });

    for (const other of BRAIN_TYPES) {
      if (other === brainType) continue;
      it(`apps/brain-${brainType}/Dockerfile does not reference seeds/${other}`, () => {
        expect(dockerfiles[brainType]).not.toContain(`seeds/${other}`);
      });
    }
  }
});
