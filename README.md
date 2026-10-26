# S-library

A Stremio addon that adds **folders** to your Stremio library. Each folder has a name, an optional description and an optional color, so you can tell your folders apart at a glance.

- Plain Node.js, **zero dependencies** (only Node's built-in `http` and `zlib`)
- No database: folders are saved in your own Stremio account and sync to every device
- One small configure page to create and edit folders

## What you get in Stremio

| Where | What you see |
| --- | --- |
| **Library** | A new **Folder** type in the type filter. Every folder shows up as a poster in its color, with its name on it, next to your movies and series. |
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

### Hosting on cPanel

Many cPanel hosts can run Node.js apps under **Software → Setup Node.js App**. If your cPanel doesn't have it, ask your host to enable Node.js.

1. **Domain:** under **Domains**, create the (sub)domain, for example `s-library.example.com`. If the domain's DNS is managed somewhere else, add an `A` record there pointing to your cPanel server's IP.
2. **HTTPS:** under **Security → SSL/TLS Status**, select the domain and click **Run AutoSSL**.
3. **Files:** upload the project, for example as a ZIP via **File Manager**, and extract it into a folder in your home directory outside `public_html`, such as `s-library-app`. `app.js` must sit directly inside that folder.
4. **App:** in **Setup Node.js App**, click **Create Application** and set:
   - Node.js version: 18 or newer (the newest available is best)
   - Application mode: Production
   - Application root: `s-library-app`
   - Application URL: your domain
   - Application startup file: `app.js`
   - Environment variable `PUBLIC_URL`: `https://s-library.example.com`

   Click **Create**. There is nothing to `npm install`, because S-library has no dependencies.
5. **Check:** `https://s-library.example.com/manifest.json` should show a short JSON text starting with `{"id":"community.slibrary"`. The configure page is at `https://s-library.example.com/configure`.

To update, upload and extract the new files over the old ones, then click **Restart** in **Setup Node.js App**.

#### Updating automatically from GitHub

Instead of uploading files, let cPanel pull them from GitHub:

1. In **Files → Git™ Version Control**, click **Create**, keep **Clone a Repository** on and set **Clone URL** to the repository and **Repository Path** to `s-library-app`. The folder must be empty or not exist yet. A private repository needs an SSH clone URL (`git@github.com:…`) and an SSH key that GitHub accepts, for example a read-only deploy key.
2. Point **Setup Node.js App** at that folder as in step 4 above.
3. Under **Advanced → Cron Jobs**, add a job that runs every 15 minutes (`*/15 * * * *`) with this command. It pulls new commits and restarts the app only when something changed:

   ```sh
   cd ~/s-library-app && OLD=$(git rev-parse HEAD) && git pull -q --ff-only && [ "$(git rev-parse HEAD)" != "$OLD" ] && { mkdir -p tmp; touch tmp/restart.txt; cloudlinux-selector restart --json --interpreter nodejs --app-root s-library-app >/dev/null 2>&1; }
   ```

   `tmp/restart.txt` is how Passenger and LiteSpeed restart an app; `cloudlinux-selector` does the same on CloudLinux servers. Whichever your server doesn't use is ignored.

Run the tests with `npm test`. The configure-page test runs only when Playwright is installed and is skipped otherwise.

## How it works

Stremio doesn't let addons change its interface, but its library accepts any content type. S-library stores folders as items in your own Stremio library. Stremio's servers keep only the fields Stremio itself uses and drop anything extra, so every part of a folder is a plain library item:

| Library item `_id` | What it holds |
| --- | --- |
| `slib:<folder id>` | The folder: type `folder` (its own type in the Library), its name, and a colored poster |
| `slib:<folder id>:info` | `name` holds `{"d": description, "c": color, "o": order}` |
| `slib:<folder id>:title:<type>:<title id>` | One per title in the folder, with the title's name and poster |

The `info` and `title` items are marked as removed, so Stremio never lists them anywhere. A title taken out of a folder keeps its item, with its type changed to `slibrary-removed`. After every save, the configure page reads the items back from Stremio and reports any change that didn't stick.

The addon then reads those items through the Stremio API and serves:

- **catalogs**: `📁 S-library` (all folders) and one catalog per folder,
- **meta** for `slib:` ids: the folder page, with links to its titles,
- **stream** for a folder's title list: one entry that opens the selected title.

Folder posters (with the folder's name), backgrounds and the logo are PNGs drawn by the addon itself and cached in memory. Names are written in Plus Jakarta Sans, the font Stremio's own interface uses, which is bundled in `fonts/` under the SIL Open Font License (`fonts/OFL.txt`).

Stremio keeps its own copy of each installed addon's manifest, and Board rows come from that copy. So after every change the configure page also refreshes the manifest stored for S-library in your addon list. Other addons in the list are left as they are.

### Files

| File | Purpose |
| --- | --- |
| `app.js` | Starts the server (`npm start`, Docker, cPanel) |
| `src/server.js` | HTTP server and routes |
| `src/addon.js` | Manifest, catalog, meta and stream responses |
| `src/shared.js` | Folder model and colors, shared by the server and the configure page |
| `src/stremio-api.js` | Stremio API client, with a 15-second cache of each account's folders |
| `src/images.js` | Folder poster, background and logo PNGs |
| `src/font.js` | Reads the bundled font and draws text for the posters |
| `fonts/` | Plus Jakarta Sans ExtraBold (Latin letters only) and its license |
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
