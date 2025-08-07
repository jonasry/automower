import fs from 'fs';

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

try {
  const lines = fs.readFileSync('./messages.txt', 'utf-8').split('\n');
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
