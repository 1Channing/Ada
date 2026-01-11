#!/usr/bin/env node

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const studyCoreIndex = join(__dirname, '../src/lib/study-core/index.ts');

if (!existsSync(studyCoreIndex)) {
  console.error('\n❌ BUILD CONTEXT ERROR');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.error('Cannot find: ../src/lib/study-core/index.ts');
  console.error('Expected path:', studyCoreIndex);
  console.error('\n🔧 RAILWAY CONFIGURATION REQUIRED:\n');
  console.error('The worker service MUST be built from the repository root,');
  console.error('not from the worker/ subdirectory.\n');
  console.error('FIX IN RAILWAY DASHBOARD:');
  console.error('  1. Go to your Railway service settings');
  console.error('  2. Set "Root Directory" to: / (blank or root)');
  console.error('  3. Set "Build Command" to: cd worker && npm ci && npm run build');
  console.error('  4. Set "Start Command" to: cd worker && npm start');
  console.error('\nAlternatively, use railway.toml in repo root (requires root context).\n');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}

console.log('✓ Build context validated: ../src/lib/study-core/ found');
