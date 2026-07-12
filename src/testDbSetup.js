import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automower-test-'));

process.env.AUTOMOWER_DB_PATH = path.join(testDbDir, 'mower-data.sqlite');

process.on('exit', () => {
  fs.rmSync(testDbDir, { recursive: true, force: true });
});
