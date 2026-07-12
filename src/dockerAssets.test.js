import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Docker image includes the message-description data used at runtime', () => {
  const dockerfile = fs.readFileSync(path.join(projectDir, 'Dockerfile'), 'utf8');
  assert.match(
    dockerfile,
    /COPY docs\/swagger\/messages\.txt \.\/docs\/swagger\/messages\.txt/
  );
  assert.equal(fs.existsSync(path.join(projectDir, 'docs/swagger/messages.txt')), true);
});
