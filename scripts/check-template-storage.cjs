#!/usr/bin/env node
// scripts/check-template-storage.cjs
"use strict";

const { checkTemplateStorage } = require("../src/modules/storage/templateStorageCheck.cjs");

const HELP = [
  "Tempasi template storage preflight",
  "",
  "Checks whether TEMPLATE_UPLOAD_DIR is available right now for",
  "uploading and reading templates (Live Demo, catalog previews,",
  "post-purchase downloads all depend on it).",
  "",
  "This is a manual, on-demand check — it is NOT part of `npm test`.",
  "The automated test suite deliberately points TEMPLATE_UPLOAD_DIR at",
  "a plain local temp directory, which this script would (correctly)",
  "flag as 'not a real mount' — that's expected there, not a bug here.",
  "",
  "The same check is also available in the admin panel:",
  "  Admin > Settings > Storage",
  "",
  "Usage:",
  "  node scripts/check-template-storage.cjs",
  "  npm run check:storage",
].join("\n");

const FAIL_MESSAGES = {
  DIR_NOT_FOUND: (r) => [
    `Reason: path does not exist: ${r.dir}`,
    ...(r.configured
      ? [
          "",
          "If this should be an sshfs (or similar) mount to the storage",
          "machine, mount it first, then re-run this check.",
        ]
      : []),
  ],
  STAT_FAILED: () => ["Reason: could not stat the directory."],
  NOT_A_MOUNT: (r) => [
    "Reason: this path exists but is NOT a distinct mounted filesystem —",
    "it looks like a plain local directory, not the storage machine.",
    "",
    "This usually means the mount either was never set up, or it dropped",
    "(the storage machine went to sleep/rebooted/lost network) and writes",
    "since then have been landing on THIS machine's local disk instead.",
    "",
    "Turn on the storage machine and (re)mount TEMPLATE_UPLOAD_DIR,",
    "then re-run this check before uploading or editing templates.",
  ],
  READ_WRITE_FAILED: () => ["Reason: read/write check raised an error."],
  READ_WRITE_MISMATCH: () => [
    "Reason: wrote a marker file but could not read back the exact content.",
  ],
};

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  console.log("Tempasi template storage preflight");
  console.log("-----------------------------------");

  const r = checkTemplateStorage();

  console.log(`TEMPLATE_UPLOAD_DIR env: ${process.env.TEMPLATE_UPLOAD_DIR || "(not set)"}`);
  console.log(`Resolved path:           ${r.dir}`);
  console.log(`Configured explicitly:   ${r.configured ? "yes" : "no (using local fallback)"}`);
  console.log("");

  if (!r.ok) {
    console.error("Result: FAIL");
    for (const line of FAIL_MESSAGES[r.failReason] ? FAIL_MESSAGES[r.failReason](r) : ["Reason: unknown."]) {
      console.error(line);
    }
    process.exit(1);
  }

  console.log(`Is a real mount point:  ${r.isMounted === null ? "n/a (local fallback)" : r.isMounted ? "yes" : "no"}`);
  console.log(`Read/write round-trip:  OK`);
  console.log("");
  console.log(`Existing template folders: ${r.templates.length}`);
  for (const t of r.templates) {
    const demoLabel = t.hasDemo ? "demo OK" : "no src/index.html";
    const previewLabel = t.hasPreview ? "preview OK" : "no preview.png";
    console.log(`  - ${t.slug}: ${demoLabel}, ${previewLabel}`);
  }

  console.log("");
  console.log("Result: PASS — storage is reachable, mounted, and read/write works.");
}

main();
