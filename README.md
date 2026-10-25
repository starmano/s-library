# S-library

A Stremio addon that adds **folders** to your Stremio library. Each folder has a name, an optional description and an optional color, so you can tell your folders apart at a glance.

- Plain Node.js, **zero dependencies** (only Node's built-in `http` and `zlib`)
- No database: folders are saved in your own Stremio account and sync to every device
- One small configure page to create and edit folders

## What you get in Stremio

| Where | What you see |
| --- | --- |
| **Library** | A new **Folder** type in the type filter. Every folder shows up as a colored folder poster next to your movies and series. |
| **Folder page** | Open a folder to see its description, the number of titles, and the titles in it. Click a title to go to it, or **Open folder** to browse it as a poster grid. |
| **Board / Discover** | A **📁 S-library** row with all your folders, plus one row per folder, marked with its color: `🔴 Favorites`, `🔵 Watch later`, … |

Colors: 🔴 red, 🟠 orange, 🟡 yellow, 🟢 green, 🔵 blue, 🟣 purple, 🟤 brown, ⚫ black, ⚪ white, or none (📁).

## Using it

1. Open the addon's configure page (`https://<your-host>/configure`) and sign in with your Stremio account.
   Signed up with Facebook, Google or Apple? Use the auth key option on the same page instead.
2. Create folders: pick a name, add a description and a color if you like, and add titles from your library or from a Stremio search.
3. Click **Install in Stremio** (or **Install in Stremio Web**). You only need to install once.

To change folders later, use **Configure** on S-library in Stremio's addon list, or open the configure page again. Changes reach Stremio the next time you open it or switch back to its window.

Removing a folder from your library inside Stremio deletes the folder. The titles in it are not touched.

## Running it

Requires Node.js 18 or newer.

```sh
npm start
# S-library running at http://127.0.0.1:7000/configure
```

For local testing, Stremio accepts `http://127.0.0.1` addons: copy the addon link from the configure page and paste it into the search box on Stremio's Addons page. Anywhere else the addon must be served over HTTPS. It runs on any Node.js host, or with the included `Dockerfile`:

```sh
docker build -t s-library .
docker run -p 7000:7000 s-library
```

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7000` | Port to listen on. |
| `PUBLIC_URL` | from the request (`Host` / `X-Forwarded-*`) | Public base URL, e.g. `https://s-library.example.com`, if the addon sits behind a proxy that doesn't send forwarding headers. |

Run the tests with `npm test`. The configure-page test runs only when Playwright is installed and is skipped otherwise.

## How it works

Stremio doesn't let addons change its interface, but its library accepts any content type. S-library stores each folder as a library item in your account:

```jsonc
{
  "_id": "slib:k3x9q2mf",         // "slib:" + folder id
  "type": "folder",               // gives folders their own type in the Library
  "name": "Favorites",
  "poster": "https://<your-host>/img/poster/red.png",
  "behaviorHints": {
    "slibrary": {                 // Stremio keeps unknown fields here when it syncs
      "v": 1,
      "description": "All-time favorites",
      "color": "red",
      "order": 0,
      "items": [{ "id": "tt0133093", "type": "movie", "name": "The Matrix" }]
    }
  }
  // ...plus the usual library item fields
}
```

The addon then reads those items through the Stremio API and serves:

- **catalogs**: `📁 S-library` (all folders) and one catalog per folder,
- **meta** for `slib:` ids: the folder page, with links to its titles,
- **stream** for a folder's title list: one entry that opens the selected title.

Folder posters and backgrounds are small PNGs drawn by the addon itself and cached in memory.

Stremio keeps its own copy of each installed addon's manifest, and Board rows come from that copy. So after every change the configure page also refreshes the manifest stored for S-library in your addon list. Other addons in the list are left as they are.

### Files

| File | Purpose |
| --- | --- |
| `src/server.js` | HTTP server and routes |
| `src/addon.js` | Manifest, catalog, meta and stream responses |
| `src/shared.js` | Folder model and colors, shared by the server and the configure page |
| `src/stremio-api.js` | Stremio API client, with a 15-second cache of each account's folders |
| `src/images.js` | Folder poster, background and logo PNGs |
| `public/configure.html` | Configure page (HTML, CSS and JavaScript in one file) |

## Privacy and security

- Your addon link contains your Stremio **auth key** (base64-encoded), because the addon has to read your folders from your account. Treat the link like a password: don't share it. If it leaks, log out of Stremio to invalidate the key, then sign in on the configure page again and reinstall.
- Signing in and saving go through the addon's server to the Stremio API (`api.strem.io`). Your password is passed on and never stored. The server keeps nothing on disk and doesn't log requests.
- Sign-in attempts are limited to 10 per minute per IP address.
- Whoever runs the server can see the auth keys in the addon links it receives. For full control, host S-library yourself.

## Limitations

- Titles are added to folders on the configure page. Stremio has no way for an addon to add an "Add to folder" button to its own screens.
- You need a Stremio account; folders are stored in it.
- If a new folder's row doesn't show up on the Board, remove S-library and install it again from the configure page. The link stays the same, so nothing is lost.
- On Stremio Web, use the title links on the left of a folder page to jump to a title. The entries in the list on the right open titles through a `stremio://` link, which only the Stremio apps handle.
