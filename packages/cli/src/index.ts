#!/usr/bin/env -S node --import tsx
/**
 * x — x_harness CLI entry point.
 *
 * Spiral 1: only `x chat` is implemented.
 */

import { loadDotEnv } from './dotenv.js';
import { runChat } from './chat.js';

const USAGE = `x_harness CLI (spiral 1)

Usage:
  x chat                 Start an interactive chat with DeepSeek.
  x run "<task>"         (not implemented yet)
  x ui                   (not implemented yet)
  x ls-actor <path>      (not implemented yet)
  x version

Environment:
  DEEPSEEK_API_KEY       required for \`x chat\`
  DEEPSEEK_BASE_URL      default: https://api.deepseek.com
  DEEPSEEK_MODEL         default: deepseek-chat
`;

async function main(): Promise<number> {
  loadDotEnv();
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      return 0;
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write('x_harness 0.0.1 (spiral 1)\n');
      return 0;
    case 'chat':
      return runChat(rest);
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`\n[fatal] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
