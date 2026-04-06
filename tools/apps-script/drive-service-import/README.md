# Drive Service Import Apps Script

This standalone Apps Script checks one Google Drive folder once per day, imports new `osz` / `osj` / `json` service files, and writes normalized services into Firestore.

## What it does

- reads a private Google Drive folder you already have access to
- scans for new or changed service files once per day
- parses service files using the same matching logic as the app
- creates missing songs in Firestore when needed
- upserts services using a deterministic document id: `YYYY-MM-DD_AM` or `YYYY-MM-DD_PM`
- skips files it has already processed unless the file's last-updated time changes
- avoids Firestore reads entirely when there are no new files to process
- uses a lightweight one-document probe for `testFirestoreConnection`

## Files

- `Code.gs`: main importer
- `appsscript.json`: manifest with required scopes

## Required Script Properties

Set these in Apps Script under `Project Settings` -> `Script properties`:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_DATABASE_ID`
- `SERVICE_DRIVE_FOLDER_ID`

## Deploy Steps

1. Create a new standalone Apps Script project.
2. Replace the default `Code.gs` with the contents of `Code.gs`.
3. Open `Project Settings` and enable `Show "appsscript.json" manifest file in editor`.
4. Replace the generated manifest with the contents of `appsscript.json`.
5. In `Project Settings` -> `Script properties`, add:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_DATABASE_ID`
   - `SERVICE_DRIVE_FOLDER_ID`
6. Save the project.
7. Run `testFirestoreConnection` once and authorize the requested scopes.
8. Run `importDailyServices` once to verify it can see the folder and write to Firestore.
9. Run `installDailyTrigger` once to create the daily trigger.

## Notes

- The script runs as the Google account that creates the trigger.
- The Google account running the script must have access to the Drive folder and permission on the Firebase / Google Cloud project.
- If you ever need to re-import everything, run `resetProcessedState()` and then run `importDailyServices()` again.
- If your app uses a named Firestore database instead of `(default)`, set `FIREBASE_DATABASE_ID` to that value. In this project it appears to be `ai-studio-df538654-5480-4d26-99ea-2b722aa1ad7a`.
