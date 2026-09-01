# Agent Development Guide

## Project Overview

This repository contains a WeChat Mini Program for film-equipment warehouse and rental management.

- `miniprogram/`: Mini Program pages, components, styles, assets, and client-side data access.
- `cloudfunctions/warehouse/`: CloudBase function for warehouses, devices, customers, rentals, schedules, exports, backup, and QR codes.
- `project.config.json`: Shared WeChat DevTools project configuration.
- `cloudbaserc.json`: CloudBase deployment configuration with placeholder values.

No production AppID, CloudBase environment ID, customer data, cloud file ID, or local developer path should be committed.

## Local Setup

1. Replace `touristappid` in `project.config.json` with your Mini Program AppID.
2. Replace `YOUR_CLOUD_ENV_ID` in:
   - `miniprogram/utils/store.js`
   - `cloudbaserc.json`
3. Open the repository root in WeChat DevTools.
4. Deploy `cloudfunctions/warehouse` using the option that installs dependencies in the cloud.
5. Set the cloud-function timeout to at least 30 seconds for PDF exports.

Keep `project.private.config.json` local. It is ignored by Git and must not be published.

## Frontend Structure

The Mini Program uses native `Page` and `Component` APIs.

- `pages/index`: dashboard and warehouse switch entry.
- `pages/devices`, `deviceForm`, `deviceDetail`: device management.
- `pages/rentals`, `rentalForm`, `rentalDetail`: rental lifecycle and outbound PDF.
- `pages/customers`, `customerDetail`: customer lookup and history.
- `pages/schedule`: equipment occupancy calendar.
- `pages/history`: statistics, logs, and PDF/CSV export.
- `pages/warehouses`: multi-warehouse management.
- `components/export-modal`: shared export options.
- `utils/store.js`: CloudBase calls, cache, date helpers, and status dictionaries.

Register new pages in `miniprogram/app.json`. Reuse existing styles and shared helpers before adding new abstractions.

## Cloud Function

`cloudfunctions/warehouse/index.js` routes calls by `event.action` and returns:

```js
{ success: true, data }
```

or:

```js
{ success: false, errMsg }
```

Cloud database collections use the `warehouse_` prefix. Database access stays in the cloud function; pages should call methods from `miniprogram/utils/store.js`.

When adding an action:

1. Validate input in the cloud function.
2. Preserve warehouse isolation.
3. Add the action to the `actions` map.
4. Add a matching method in `store.js`.
5. Invalidate relevant client caches after writes.

## Sensitive Data Rules

Never commit:

- real AppIDs or CloudBase environment IDs;
- `project.private.config.json`;
- customer exports, backups, rental PDFs, or CSV files;
- cloud storage file IDs, OpenIDs, UnionIDs, access tokens, or secrets;
- local absolute paths, IDE state, logs, or screenshots containing user data.

Use placeholders in documentation and sample configuration. Seed data must remain fictional.

## Verification

Before publishing or submitting changes:

1. Parse all JSON configuration files.
2. Run a syntax check over JavaScript files.
3. Search for AppIDs, environment IDs, phone numbers, emails, tokens, and local paths.
4. Compile in WeChat DevTools.
5. Deploy the cloud function to a non-production environment.
6. Test warehouse isolation, rental creation/return, PDF/CSV export, backup/restore, and QR-code flows.

Keep all source files UTF-8 encoded. PowerShell terminal output may display Chinese incorrectly even when file contents are valid, so verify encoding with an editor or parser before rewriting text.
