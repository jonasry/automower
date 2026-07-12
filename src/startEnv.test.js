import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loaderPath = path.join(projectDir, 'src/loadEnv.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));

function runLoader(cwd, env = {}) {
  const childEnv = { ...process.env, ...env };
  if (env.DATABASE_URL === undefined) delete childEnv.DATABASE_URL;

  return spawnSync(process.execPath, [
    '--import', loaderPath,
    '--input-type=module',
    '--eval', 'process.stdout.write(process.env.DATABASE_URL ?? "")'
  ], { cwd, env: childEnv, encoding: 'utf8' });
}

test('npm start loads DATABASE_URL from .env', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automower-env-test-'));
  fs.writeFileSync(path.join(directory, '.env'), 'DATABASE_URL=postgresql://from-dotenv\n');

  try {
    const result = runLoader(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'postgresql://from-dotenv');
    assert.equal(packageJson.scripts.start, 'node --import ./src/loadEnv.js src/app.js');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('existing environment variables override .env values', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'automower-env-test-'));
  fs.writeFileSync(path.join(directory, '.env'), 'DATABASE_URL=postgresql://from-dotenv\n');

  try {
    const result = runLoader(directory, { DATABASE_URL: 'postgresql://from-shell' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'postgresql://from-shell');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
