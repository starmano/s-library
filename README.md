# S-library

A Stremio addon that adds **folders** to your Stremio library. Each folder has a name, an optional description and an optional color, so you can tell your folders apart at a glance.

- Plain Node.js, **zero dependencies** (only Node's built-in `http` and `zlib`)
- No database: folders are saved in your own Stremio account and sync to every device
- Create and edit folders inside Stremio, or on one small configure page

## What you get in Stremio

| Where | What you see |
| --- | --- |
| **Library** | A new **Folder** type in the type filter. Every folder shows up as a poster in its color, with its icon and name on it, next to your movies and series. |
| **Folder page** | Open a folder to see its description, the number of titles, and the titles in it. **🖼️ Show as posters** (at the top of its stream list, and among its links) opens the folder as a poster grid: tap a poster to open the title, and back brings you to the grid again. Below it, each title has its own entry that opens it. Links on the page rename, describe, recolor, move or delete the folder. |
| **Board / Discover** | A **📁 S-library** row with all your folders, plus one row per folder, marked with its color: `🔴 Favorites`, `💗 Watch later`, … |
| **A movie or show** | Its list of streams shows your folders: one tap adds the title to a folder, or starts a new folder with it. |
| **Search** | Your folders, and a card to create a folder with that name. |

Switches on the configure page take folders out of the Library, out of Discover (which also removes their rows from the Board, since Stremio shows the same rows in both) or out of search.

Colors: 🔴 red, 🟥 wine, 💗 pink, 🟧 peach, 🟠 orange, 🟨 gold, 🟡 yellow, 🟩 lime, 🟢 green, 💚 mint, 🔷 sky, 🔵 blue, 🟦 navy, 🟣 purple, 🟤 brown, 🔘 gray, ⚫ black, ⚪ white, or none (📁). Stremio shows row names as plain text, so a colored emoji shape is what marks a folder's row. Emoji only come in a few colors, so shades such as wine and red share a color and differ in shape; the poster has the exact color.

Icons: 96 to choose from (genres, moods, seasons, sports and more), or none. Each folder's name is required, but you can leave it off the poster.

## Using it

1. Open the addon's configure page (`https://<your-host>/configure`) and sign in with your Stremio account.
   Signed up with Facebook, Google or Apple? Use the auth key option on the same page instead.
2. Click **Install in Stremio** (or **Install in Stremio Web**). You only need to install once.
3. Create folders, here or inside Stremio: pick a name, and if you like a description, a color and an icon. On the configure page you can add titles from your library, from a Stremio search, or from **Recommended**: popular movies and shows in the same genres as the titles already in the folder, most popular first (from Cinemeta, Stremio's own catalog). The genres are shown above the list; tap one to leave it out, or tap it again to use it again. This browser remembers the genres you left out, per folder. **Sort** puts the list in order of popularity, IMDb rating or release year.

### Inside Stremio

Stremio doesn't let addons add buttons, so S-library works through what Stremio already shows: links on a folder's page, cards in search results and entries in a title's list of streams. Opening one makes the change and shows the folder (or S-library's own page) with a ✓ message at the top.

- **Add a title to a folder:** open a movie or show. Its list of streams shows your folders: one tap on a folder adds the title. A short "✓ Added" page opens; press back to return to the title. Folders that already have it are marked "✓ Already in this folder". **📁 New folder** creates a folder with the title in it.
- **Create a folder:** search for `new folder: Road trip` and open the **＋ New folder "Road trip"** card. Any search also offers a new folder with what you typed. The **New folder** link on a folder's page fills in the search for you.
- **Rename or describe a folder:** tap **Rename** or **Description** on its page. This opens the search with `rename Favorites: ` (or `describe Favorites: `) typed in: type the new name or description after the colon and open the card.
- **Color, icon, order:** tap a color or icon on the folder's page (the current one has a ✓), or **Move up** / **Move down**.
- **Delete a folder:** tap **Delete** on its page and confirm. The titles in it are not touched.
- **Take a title out of a folder:** on the configure page (**Edit on the web** on a folder's page opens it).
- **Show or hide folders in the Library:** tap **Hide folders from my Library** on any folder's page, or use the switch on the configure page. Hidden folders stay on the Board, in Discover under the type **Folder**, and in search (unless those are switched off too).

Edit links are made for the folder as it was when its page opened. Stremio loads a page again when you go back to it; if the folder has changed since, the old link changes nothing and says so, so going back never undoes a newer change.

Stremio Web (and any Stremio app that talks to addons the way a browser does) opens stream-list entries in a new tab, so there they open a small confirmation page instead, and **New folder with this title** opens the configure page.

Changes to the folder rows on the Board reach Stremio the next time you open it or switch back to its window. There's no need to install the addon again.

The version the server runs is shown next to the title on the configure page, with a one-line note on what changed. Tap it for all the release notes.

Stremio's own **Remove from library** button on a folder's page only takes that folder out of the Library: the folder and its titles stay, on the Board, in Discover and in search, and **Add to library** on its page puts it back. Only **Delete** deletes a folder, and it asks first. (Up to version 1.5, Stremio's button deleted the folder; folders deleted that way stay deleted.)

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
   cd ~/s-library-app && OLD=$(git rev-parse HEAD) && git pull -q --ff-only && [ "$(git rev-parse HEAD)" != "$OLD" ] && { mkdir -p tmp; touch tmp/restart.txt; cloudlinux-selector restart --json --interpreter nodejs --app-root s-library-app >/dev/null 2>&1 || pkill -u "$(id -un)" -f "lsnode|NodeApp|node app\.js"; }
   ```

   Use your app's **Application root** in place of `s-library-app` (both times). `tmp/restart.txt` is how Passenger and LiteSpeed restart an app, and `cloudlinux-selector` does the same on CloudLinux servers. If that command fails, the job stops the running app instead, and the server starts it again, with the new code, on the next visit.

   To check which folder the domain really runs, look for `PassengerAppRoot` in the `.htaccess` file of the domain's document root.

Run the tests with `npm test`. The configure-page test runs only when Playwright is installed and is skipped otherwise.

To release a new version, raise `version` in `package.json` and add a section for it at the top of `CHANGELOG.md`. The configure page and the manifest show it, and a test fails if the two don't match.

## How it works

Stremio doesn't let addons change its interface, but its library accepts any content type. S-library stores folders as items in your own Stremio library. Stremio's servers keep only the fields Stremio itself uses and drop anything extra, so every part of a folder is a plain library item:

| Library item `_id` | What it holds |
| --- | --- |
| `slib:<folder id>` | The folder: type `folder` (its own type in the Library), its name, and a colored poster |
| `slib:<folder id>:info` | `name` holds `{"d": description, "c": color, "o": order, "i": icon, "h": 1 if the name is left off the poster, "t": version}` |
| `slib:<folder id>:title:<type>:<title id>` | One per title in the folder, with the title's name and poster |
| `slib::settings` | `name` holds `{"library", "discover", "search": where folders show in Stremio, "t": version}` |

The `info`, `title` and `settings` items are marked as removed, so Stremio never lists them anywhere. Hiding folders from the Library marks the folder items removed too. A deleted folder, or a title taken out of a folder, keeps its item, with its type changed to `slibrary-removed`. After every save, the configure page and the addon read the items back from Stremio and report any change that didn't stick.

The addon then reads those items through the Stremio API and serves:

- **catalogs**: `📁 S-library` (all folders) and one catalog per folder, unless folders are switched off in Discover,
- **catalog** `slib.search`: S-library's search results (folders, and cards that create, rename or describe one). With folders switched off in search, it only answers the `new folder:`, `rename` and `describe` searches,
- **meta** for `slib:` ids: the folder page, with links to its titles and to edit it. It has no videos, and `behaviorHints.defaultVideoId` is its own id (as on the folder's library item), so Stremio shows its stream list straight away. Older Stremio apps, like the one on Samsung TVs, need that hint,
- **meta** for `slib:do:<action>:<folder id>:<version>[:<argument>]` ids: the page an edit link or card opens. Asking for it makes the change through the Stremio API (`src/actions.js`) and returns the folder page with the outcome. Changes to the folder itself only apply when `<version>` matches the folder's current version.
- **stream** for every movie and show: one entry per folder, to add the title, plus **New folder**. In the Stremio apps each entry opens an `slib:do:` page. Stremio Web sends an `Origin` header and opens entries in a new tab, so it gets `/<config>/act/add/<folder>/<type>/<id>` instead, which adds the title and shows a confirmation page. A title's name and poster come from your library, or from Cinemeta.
- **stream** for a folder (and for the pages its edit links open): **🖼️ Show as posters**, which opens the folder's row in Discover, then one entry per title that opens it. A title opened from a stream list loses its way back in Stremio, and the Android app shows no pictures there; the grid has both. With folders left out of Discover, only the titles are listed. Stremio Web opens stream entries in a new tab, so it gets Stremio Web addresses.

Folder posters (with the folder's name and icon), backgrounds and the logo are PNGs drawn by the addon itself and cached in memory. Names are written in Plus Jakarta Sans, the font Stremio's own interface uses, which is bundled in `fonts/` under the SIL Open Font License (`fonts/OFL.txt`). Icons are a selection of [Phosphor Icons](https://phosphoricons.com) (fill style, MIT license, `icons/LICENSE`).

Stremio keeps its own copy of each installed addon's manifest, and Board rows come from that copy. So after every change to the folder rows, the configure page or the addon also refreshes the manifest stored for S-library in your addon list. Other addons in the list are left as they are.

### Files

| File | Purpose |
| --- | --- |
| `app.js` | Starts the server (`npm start`, Docker, cPanel) |
| `src/server.js` | HTTP server and routes |
| `src/addon.js` | Manifest, catalog, meta and stream responses, including the in-app edit links |
| `src/actions.js` | What the in-app edit links and cards do |
| `src/shared.js` | Folder model and colors, shared by the server and the configure page |
| `src/stremio-api.js` | Stremio API client, with a 15-second cache of each account's folders, and saving with read-back |
| `src/images.js` | Folder poster, background and logo PNGs |
| `src/font.js` | Reads the bundled font |
| `src/raster.js` | Draws text and icons (SVG paths) with smooth edges |
| `fonts/` | Plus Jakarta Sans ExtraBold (Latin letters only) and its license |
| `icons/` | The folder icons (SVG path data) and their license |
| `public/configure.html` | Configure page (HTML, CSS and JavaScript in one file) |
| `CHANGELOG.md` | What changed in each version, shown on the configure page |

## Privacy and security

- Your addon link contains your Stremio **auth key** (base64-encoded), because the addon has to read your folders from your account. Treat the link like a password: don't share it. If it leaks, log out of Stremio to invalidate the key, then sign in on the configure page again and reinstall.
- Signing in and saving go through the addon's server to the Stremio API (`api.strem.io`). Your password is passed on and never stored. The server keeps nothing on disk and writes no logs. In memory it keeps the last 40 requests each account's Stremio apps made (when, which app, what it asked for, how it went; no auth keys or IP addresses), which the configure page shows to that account under **Recent requests from Stremio**, to find out why an app doesn't work. Restarting the server clears them.
- Sign-in attempts are limited to 10 per minute per IP address.
- Whoever runs the server can see the auth keys in the addon links it receives. For full control, host S-library yourself.

## Limitations

- Stremio has no way for an addon to add an "Add to folder" button or a text field to its own screens, which is why folders are edited through stream lists, links and search.
- Stremio doesn't always ask for a page again right away, so the folder rows on the Board can take a moment (or a restart of Stremio) to catch up with a change.
- You need a Stremio account; folders are stored in it.
- If a new folder's row doesn't show up on the Board, remove S-library and install it again from the configure page. The link stays the same, so nothing is lost.
- Stremio opens a stream-list entry like an outside link: going back afterwards doesn't return to the page you came from. That's why a folder's titles open from its poster grid. On Stremio Web, stream-list entries open in a new tab.
