# Open Source Release Checklist

This copy has been sanitized for public review. Complete the remaining owner decisions before publishing.

## Sanitization Completed

- Replaced the production Mini Program AppID with `touristappid`.
- Replaced the CloudBase environment ID with `YOUR_CLOUD_ENV_ID`.
- Removed `project.private.config.json`.
- Removed internal code-review notes.
- Removed the internal development plan.
- Removed the unused CloudBase example page that demonstrated OpenID logging.
- Removed local absolute paths from `agent.md`.
- Added ignore rules for local IDE settings, private project settings, logs, backups, PDF/CSV exports, and dependency folders.
- Confirmed that no customer records, phone numbers, email addresses, OpenIDs, UnionIDs, cloud file IDs, access tokens, private keys, or local user paths are committed as source data.
- Kept only fictional equipment seed data.

## Required Before Publishing

- [x] Add the project-level GPL-3.0-only `LICENSE`.
- [ ] Confirm the repository name and public description.
- [ ] Review all images and brand assets for redistribution rights.
- [ ] Confirm the bundled Noto Sans SC file matches the included `OFL.txt`.
- [ ] Initialize a fresh Git repository inside this sanitized copy; do not copy the original `.git` directory.
- [ ] Run a secret scanner over the final Git history before pushing.
- [ ] Create a non-production CloudBase environment for public testing.
- [ ] Replace placeholders only in local working copies, never in the public default branch.

## Local Values To Configure

- `project.config.json`: replace `touristappid` with your own Mini Program AppID.
- `miniprogram/utils/store.js`: replace `YOUR_CLOUD_ENV_ID`.
- `cloudbaserc.json`: replace `YOUR_CLOUD_ENV_ID`.
- WeChat DevTools may create `project.private.config.json`; keep it untracked.

## Pre-Push Scan

Run from the repository root:

```powershell
rg -n --hidden -g '!node_modules/**' -g '!*.png' -g '!*.jpg' -g '!*.otf' "cloud1-|wx[0-9a-fA-F]{16}|C:\\Users\\|BEGIN .*PRIVATE KEY|AKID|SecretKey|access_token|openid|unionid"
```

Expected output: no real credentials or identifiers. References to field names in documentation or source logic should be reviewed manually.
