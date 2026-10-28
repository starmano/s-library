# Changelog

The configure page shows the newest entry here. For a new version, raise `version` in `package.json` and add a section at the top; a test checks that the two match.

## 1.16.0 — 2026-10-28

- Folders no longer keep watch progress. After a movie was played from a folder on a TV, Stremio opened that folder on the movie (on every device) and showed it in Continue Watching; S-library now clears that, so folders open as folders. A movie played from a folder starts from the beginning next time.

## 1.15.1 — 2026-10-27

- After a movie was played from a folder on a TV, opening that folder (for example from the Library) showed only that movie. It shows all of them again.

## 1.15.0 — 2026-10-27

- Samsung and LG TVs: picking a title in a folder shows its streams from your other addons, so it plays straight from the folder. (Stremio on those TVs can't open a movie's page from there; it offered to leave Stremio instead.)

## 1.14.0 — 2026-10-27

- Samsung and LG TVs: a folder's page lists its titles with pictures, instead of loading forever. The links in S-library's entries are also given to the TV apps in the form they read. Open the configure page once so folders in your Library get the change too.

## 1.13.1 — 2026-10-27

- "Recent requests from Stremio" now shows the requests of all your Stremio apps. Before, it only showed requests made with the same sign-in as the configure page, and each sign-in is a new one.
- Changes made on the configure page now also reach the S-library that's installed in Stremio when it was installed with an earlier sign-in.

## 1.13.0 — 2026-10-26

- New "Recent requests from Stremio" section at the bottom of the configure page: it shows which of your Stremio apps reached S-library, what they asked for and how it went, to find out why an app (like a TV) doesn't work.

## 1.12.1 — 2026-10-26

- Folders open in older Stremio apps too, such as the one on Samsung TVs, instead of loading forever. Open the configure page once so folders in your Library get the fix as well.

## 1.12.0 — 2026-10-26

- Sort recommendations by most popular, best rated (IMDb rating) or newest. Each title shows its year and rating.

## 1.11.0 — 2026-10-26

- The Recommended tab shows the genres its titles come from. Tap a genre to leave it out, or tap it again to use it again; each folder remembers its choice in this browser.

## 1.10.0 — 2026-10-26

- A folder's page lists its titles again, below "🖼️ Show as posters". One tap on a title opens it.

## 1.9.1 — 2026-10-26

- The release notes on the configure page stay closed until you tap them, and scroll inside their own box.

## 1.9.0 — 2026-10-26

- A folder's page leads to the folder as posters ("🖼️ Show as posters"). Tap a poster to open the title; back brings you to the posters again.

## 1.8.0 — 2026-10-26

- A folder's page lists its titles with their posters, and one tap opens a title, without an "Open title" step in between.

## 1.7.0 — 2026-10-26

- Adding a title to a folder from its list of streams is one tap, with a short "✓ Added" page that leads straight back to the title.
- Titles can no longer be taken out of folders inside Stremio; do that on the configure page.

## 1.6.0 — 2026-10-26

- Taking a title out of a folder in Stremio now asks first, and the page after it has an Undo link.
- Clearer entries in the list of streams: "🎬 Open title", "🗑️ Remove from folder", "＋ Tap to add it to this folder" and "📁 New folder".
- Stremio's own "Remove from library" button no longer deletes a folder: it only takes the folder out of the Library, and "Add to library" puts it back. Deleting is done with Delete, which asks first.

## 1.5.1 — 2026-10-26

- Rows for the newer colors are marked with plain colored shapes instead of pictures: 🟥 wine, 💗 pink, 🟧 peach, 🟨 gold, 🟩 lime, 💚 mint, 🔷 sky and 🟦 navy.

## 1.5.0 — 2026-10-26

- New switches on the configure page: show folders in Discover (and on the Board), and show folders in search.
- Choose whether a folder's name is written on its poster. The name itself is still required.
- "No icon" option, nine more colors (wine, pink, peach, gold, lime, mint, sky, navy, gray) and 56 more icons.
- The color and icon lists stay folded away until you press "+", and the editor shows a live preview of the poster.
- The Delete, Cancel and Save buttons always stay at the bottom of the screen.
- New "Recommended" tab under "Add titles": popular movies and shows in the same genres as the titles in the folder.

## 1.4.0 — 2026-10-26

- Edit folders without leaving Stremio: a folder's page has links to rename it, describe it, change its color or icon, move it and delete it.
- Create folders in Stremio: search for "new folder: " and a name, or pick "New folder with this title" in a movie's list of streams.
- In the Stremio apps, adding a title to a folder happens inside the app, without opening a browser.
- A new switch hides folders from your Stremio Library, so it only shows movies and shows. The folders stay on the Board, in Discover and in search.

## 1.3.0 — 2026-10-26

- Add movies and shows to folders inside Stremio: open a title and pick a folder in its list of streams, or start a new folder with it.
- Folder pages in Stremio have "Edit this folder" and "New folder" links, which open the editor straight away.
- Choose an icon for each folder: romance, war, thriller, sci-fi, western, action, spy, gangster and 30 more.
- Titles in a folder's list can be taken out of the folder from Stremio.

## 1.2.0 — 2026-10-26

- Folder posters show the folder's name, so folders are easy to tell apart.
- The configure page shows which version is running and what changed.
- Image links use https unless the addon runs on your own computer.

## 1.1.0 — 2026-10-25

- Folders keep their titles: they're now saved in a way Stremio's servers don't throw away.
- Every save is checked with Stremio, and the page says so if something didn't stick.
- Runs on cPanel hosting (Setup Node.js App).

## 1.0.0 — 2026-10-25

- First version: folders with a name, description and color, shown in the Stremio Library, on the Board and in Discover.
