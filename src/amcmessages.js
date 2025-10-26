import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const messageDescriptions = new Map();
const severitySymbols = new Map([
  ['FATAL', '💀'],
  ['ERROR', '❌'],
  ['WARNING', '⚠️'],
  ['INFO', 'ℹ️'],
  ['DEBUG', '🐛'],
  ['SW', '📦'],
  ['UNKNOWN', '❓']
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const messagesPath = path.resolve(__dirname, '../docs/swagger/messages.txt');
  const lines = fs.readFileSync(messagesPath, 'utf-8').split('\n');
  for (const line of lines) {
    const [code, desc] = line.split('\t');
    if (code && desc) {
      messageDescriptions.set(parseInt(code), desc.trim());
    }
  }
} catch (err) {
  console.error('Failed to load message descriptions:', err);
}

export { messageDescriptions, severitySymbols };
