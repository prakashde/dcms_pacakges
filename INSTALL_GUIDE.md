# DCMS Form Packages — Installation Guide

Simple end-to-end steps to build `@dcms/form-rules` + `@dcms/form-rules-react` and install them into the DCMS app.

> **Why this guide exists:** the package versions stay fixed (e.g. `0.10.5`, `0.4.0-parity.6`), so after you replace a `.tgz` with new content, npm can trust the old integrity hash in `package-lock.json` and **skip re-extracting it**. The steps below (4 and 5) force npm to pick up the new files.

---

## Step 1 — Build the packages

Run inside **`DCMS-form-packages/`**:

```bash
npm ci
npm run build
npm run pack
```

This produces fresh tarballs in `DCMS-form-packages/artifacts/`:

- `dcms-form-rules-0.10.5.tgz`
- `dcms-form-rules-react-0.4.0-parity.6.tgz`
- (plus matching `.sha256` files)

---

## Step 2 — Copy the tarballs into DCMS

Copy the `.tgz` files from `DCMS-form-packages/artifacts/` into **`DCMS/vendor/`**, overwriting the old ones:

```bash
cp DCMS-form-packages/artifacts/dcms-form-rules-0.10.5.tgz \
   DCMS-form-packages/artifacts/dcms-form-rules-react-0.4.0-parity.6.tgz \
   DCMS/vendor/
```

---

## Step 3 — One-time setup in DCMS/package.json (skip if already done)

```jsonc
"dependencies": {
  "@dcms/form-rules": "file:vendor/dcms-form-rules-0.10.5.tgz",
  "@dcms/form-rules-react": "file:vendor/dcms-form-rules-react-0.4.0-parity.6.tgz"
},
"overrides": {
  "@dcms/form-rules-react": {
    "react": "$react"
  }
}
```

---

## Step 4 — Remove the stale installs and cache

**Run this every time you copy new tarballs.** Run inside **`DCMS/`**:

```bash
rm -rf node_modules/@dcms node_modules/.cache
```

- `node_modules/@dcms` — the old extracted package files.
- `node_modules/.cache` — CRA/webpack + Babel build cache (it can keep serving the old compiled code).

---

## Step 5 — Reinstall from the new tarballs

### What the problem is (plain English)

`package-lock.json` is npm's **receipt** for what it installed. For every package it stores a fingerprint of the exact file it copied — a field called `integrity` (a SHA-512 hash of the `.tgz` bytes).

Because you keep the **same filename and the same version number**, the old receipt still matches npm's cache, so a plain `npm install` concludes *"I already have this exact file installed"* and **does nothing** — the new tarball in `vendor/` is never even opened. That is the entire reason your changes were not reflecting.

### The fix (one command)

Tell npm to install **from the tarball files themselves**. When you pass a file path, npm has no choice but to open that file, calculate a fresh fingerprint, update the receipt, and re-extract the package. Run inside **`DCMS/`**:

```bash
cd DCMS
npm install --save-exact ./vendor/dcms-form-rules-0.10.5.tgz ./vendor/dcms-form-rules-react-0.4.0-parity.6.tgz
```

That's it. Two things this does **not** do:

| You might worry | Reality |
|---|---|
| It rewrites my `package.json` specs | No — the dependencies stay exactly `file:vendor/...` as before (verified). |
| It re-downloads everything from the internet | No — only the two local tarballs are re-read; everything else comes from the local cache. |

Expected: npm prints its usual summary and audit warnings (audit warnings are normal, not errors).

### Fallback — if npm reports `EINTEGRITY` or refuses to update

Remove the stale `@dcms` lines from the receipt with the helper script that ships in the DCMS repo (it only edits `package-lock.json`; the next `npm install` re-creates the entries fresh). Run it from the **`DCMS/`** folder:

```bash
node scripts/refresh-dcms-lock.js
npm install --save-exact
```

Expected output: `stale @dcms lockfile entries removed (12 -> 0)`, then npm installs normally.

> ⚠️ **Do not paste the old `node -e "..."` one-liner into PowerShell or Command Prompt.** Those shells handle quotes and line breaks differently than Git Bash, so the command fails with a syntax error before it ever runs. The `node scripts/refresh-dcms-lock.js` form works in *any* shell, because the code lives in the file instead of the command line.

---

## Step 6 — Verify the new code actually landed

Run inside **`DCMS/`** — replace the string with a marker from your change (or temporarily add a `console.log` to your package source):

```bash
grep -c "YOUR_MARKER_STRING" node_modules/@dcms/form-rules-react/dist/FormEditor.js
```

- Output `≥ 1` → install succeeded, continue.
- Output `0` → npm still has stale files; repeat Steps 4–5.

---

## Step 7 — Run or build the DCMS app

**Dev server** (restart it after every reinstall):

```bash
npm start
```

**Production build** (the large app needs extra heap, otherwise it dies with *heap out of memory*):

```bash
NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts build
```

Optional final check — confirm your change is inside the built bundle:

```bash
grep -rl "YOUR_MARKER_STRING" build/static/js
```

---

## Quick reference (copy-paste sequence)

```bash
# 1. Build + pack (in DCMS-form-packages/)
cd DCMS-form-packages
npm ci && npm run build && npm run pack

# 2. Copy tarballs (from repo root)
cp DCMS-form-packages/artifacts/dcms-form-rules-0.10.5.tgz \
   DCMS-form-packages/artifacts/dcms-form-rules-react-0.4.0-parity.6.tgz \
   DCMS/vendor/

# 4-5. Bust stale caches + reinstall from the tarballs (in DCMS/)
cd DCMS
rm -rf node_modules/@dcms node_modules/.cache
npm install --save-exact ./vendor/dcms-form-rules-0.10.5.tgz ./vendor/dcms-form-rules-react-0.4.0-parity.6.tgz

# 6. Verify (should print >= 1)
grep -c "YOUR_MARKER_STRING" node_modules/@dcms/form-rules-react/dist/FormEditor.js

# 7. Run
npm start
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Change not visible after install | Repeat Steps 4–5, then verify with Step 6. |
| Change in node_modules but not in the app | Restart `npm start`; if building, use Step 7's `NODE_OPTIONS` line. |
| Build fails with *heap out of memory* | Use `NODE_OPTIONS=--max-old-space-size=8192 npx react-scripts build`. |
| `EINTEGRITY` error during `npm install` | Use the fallback script in Step 5 (it deletes the `@dcms` entries from `package-lock.json`), then run `npm install --save-exact` again. |
| Still stale? | Bump the version in the package's `package.json` (e.g. `0.4.0-parity.7`), re-run `npm run pack`, update the filenames in `DCMS/package.json`, then repeat Steps 2–6. |
