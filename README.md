# Bike Spot Logger — Static Netlify IndexedDB Test

Mobile-first field app for recording bike drop-off spots and exporting a Word-compatible report.

## Netlify settings

- Build command: leave empty
- Publish directory: `.`

## Files required in the site root

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `netlify.toml`

## Storage

This version uses IndexedDB for saved spots instead of localStorage. This is intended to be more reliable for records with photos. The app still uses localStorage only for the Default Grid Name and migration flags.

## Features

- Default Grid Name
- Editable Grid Name per spot
- GPS capture
- Google Maps URL generation
- Camera/photo upload
- Compressed photos
- Spot in App + conditional App Spot Name
- Observations checklist
- Additional comments
- JSON import/export
- Delete Today’s Records
- Word-compatible `.doc` report export


## DOCX export

This version loads `html-docx-js` from jsDelivr and generates a `.docx` report from the report HTML. If the external converter cannot load, the app falls back to the older Word-compatible `.doc` export.


## Safe loading update

This version avoids rendering saved photos in the spot list. It only loads full photos when editing a single record, exporting DOCX, or exporting full JSON. This reduces the risk of Safari crashing when many photo records are stored in IndexedDB.
