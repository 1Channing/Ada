# Railway Build Context Fix - Summary

**Status:** 🔧 REQUIRES MANUAL RAILWAY DASHBOARD CONFIGURATION
**Date:** 2026-01-11
**See:** `RAILWAY_MONOREPO_CONFIG.md` for complete guide

---

## Problem

Railway deployment fails with:
```
[ERROR] Could not resolve "../src/lib/study-core/index"
```

**Root cause:** Railway service "Root Directory" is set to `worker/`, so `../src/` doesn't exist in the build container.

---

## Solution: Update Railway Dashboard Settings

**YOU MUST MANUALLY CONFIGURE IN RAILWAY DASHBOARD:**

### 1. Service Settings → Root Directory
```
/
```
(Or leave **completely blank**)

### 2. Service Settings → Build Command
```bash
cd worker && npm ci && npm run build
```

### 3. Service Settings → Start Command
```bash
cd worker && npm start
```

### 4. Redeploy

---

## Why `railway.toml` Was Ignored

The `railway.toml` file at repository root is only read if Railway's build context includes the repository root.

**Before (broken):**
- Railway Root Directory = `worker/`
- Build context = `worker/` only
- `railway.toml` at `../railway.toml` (outside container) → **ignored**
- `src/` at `../src/` (outside container) → **inaccessible**

**After (fixed):**
- Railway Root Directory = `/` (repo root)
- Build context = entire repository
- `railway.toml` at `/railway.toml` → **detected and used**
- `src/` at `/src/` → **accessible to worker build**

---

## Files Added/Modified

| File | Status | Purpose |
|------|--------|---------|
| `railway.toml` | ✅ CREATED | Railway config (Nixpacks) |
| `package.json` (root) | ✅ UPDATED | Added `build:worker`, `start:worker` scripts |
| `worker/package.json` | ✅ UPDATED | Added `prebuild` validation |
| `worker/check-build-context.js` | ✅ CREATED | Build context safeguard |
| `RAILWAY_MONOREPO_CONFIG.md` | ✅ CREATED | Complete configuration guide |

---

## Local Validation

Test that Railway configuration will work:

```bash
# Build from repo root (should succeed)
npm run build:worker

# Expected output:
✓ Build context validated: ../src/lib/study-core/ found
  dist/index.js  42.3kb
⚡ Done in 40ms
```

Test that safeguard catches misconfiguration:

```bash
# Simulate Railway's wrong config (should fail with clear error)
mkdir /tmp/test && cp -r worker /tmp/test/
cd /tmp/test/worker && npm install && npm run build

# Expected output:
❌ BUILD CONTEXT ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cannot find: ../src/lib/study-core/index.ts
🔧 RAILWAY CONFIGURATION REQUIRED:
[... instructions ...]
```

---

## After Railway Configuration

Once Railway is configured correctly, the build will:

1. ✅ Detect `railway.toml` at repo root
2. ✅ Execute: `cd worker && npm ci && npm run build`
3. ✅ Pass validation: `✓ Build context validated`
4. ✅ Bundle successfully: `dist/index.js 42.3kb`
5. ✅ Start with: `cd worker && npm start`
6. ✅ Worker listens on Railway's `$PORT`

---

## Zero Code Duplication

This solution maintains a single source of truth:

- **Canonical source:** `src/lib/study-core/` (shared parsing logic)
- **Frontend:** Imports from `@/lib/study-core`
- **Worker:** Imports from `../src/lib/study-core`
- **Build output:** esbuild bundles shared code into `worker/dist/index.js`
- **No drift:** Changes automatically included in both frontend and worker builds

---

## See Complete Guide

For detailed configuration steps, validation checklist, and troubleshooting:

📖 **[RAILWAY_MONOREPO_CONFIG.md](./RAILWAY_MONOREPO_CONFIG.md)**

Covers:
- Detailed Railway dashboard configuration
- Build context architecture diagrams
- Validation checklist
- Potential runtime issues (Node version, env vars, memory)
- Troubleshooting guide
