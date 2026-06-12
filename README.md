# Pigeon Crumbs

A tiny static website: click anywhere on the screen to drop a breadcrumb, then one small pigeon arrives after one second to eat it.

Made with Codex.

## PigeonDex

Open `public/pigeondex.html` to search pigeon breeds, favorite breeds, compare two breeds, or jump to a random pigeon. Breed data is loaded in the browser from live Wikipedia, Wikidata, and Wikimedia image API calls.

## Deploy on Vercel

Import this folder as a Vercel project. Vercel will serve the site from the `public/` folder, so no custom build command is needed.

## Run locally

```bash
npm start
```

Then open `http://localhost:3000`. The local Node.js server serves the same `public/` folder.
