import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExclusions, loadConfig, readApiKey } from '../src/config.ts';

test('readExclusions returns empty arrays for missing file', () => {
  const result = readExclusions('/path/that/does/not/exist.json');
  assert.deepEqual(result, {
    models: [],
    modelFamilies: [],
  });
});

test('readExclusions parses valid exclusion file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-omni-test-'));
  const filePath = join(dir, 'excluded-models.json');
  try {
    writeFileSync(filePath, JSON.stringify({
      models: ['codex/m1', 'agy/m2'],
      modelFamilies: ['gpt-5.6'],
    }));

    const result = readExclusions(filePath);
    assert.deepEqual(result.models, ['codex/m1', 'agy/m2']);
    assert.deepEqual(result.modelFamilies, ['gpt-5.6']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readExclusions rejects invalid format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-omni-test-'));
  const filePath = join(dir, 'invalid.json');
  try {
    writeFileSync(filePath, JSON.stringify({
      models: 'not an array',
    }));
    assert.throws(() => readExclusions(filePath), /must be an array of non-empty strings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig validates base URL and trailing slashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-omni-test-'));
  try {
    assert.throws(() => {
      loadConfig({
        OMNIROUTE_BASE_URL: 'invalid-url',
        OMNIROUTE_STATE_DIR: dir,
      });
    }, /base URL must be an absolute HTTP\(S\) URL/);

    assert.throws(() => {
      loadConfig({
        OMNIROUTE_BASE_URL: 'ftp://localhost/v1',
        OMNIROUTE_STATE_DIR: dir,
      });
    }, /base URL must use HTTP or HTTPS/);

    const config = loadConfig({
      OMNIROUTE_BASE_URL: 'https://gateway.local:444/v1///',
      OMNIROUTE_STATE_DIR: dir,
    });
    assert.equal(config.baseUrl, 'https://gateway.local:444/v1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readApiKey prioritizes env variable over file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-omni-test-'));
  const keyFile = join(dir, 'key.txt');
  try {
    writeFileSync(keyFile, 'file-key-12345');

    const envKey = readApiKey(keyFile, {
      OMNIROUTE_API_KEY: 'env-key-999',
    });
    assert.equal(envKey, 'env-key-999');

    const fileKey = readApiKey(keyFile, {});
    assert.equal(fileKey, 'file-key-12345');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
