// What S-library's in-app links, search cards and stream-list entries do (see addon.js). Each
// action edits the user's library and says which page to show afterwards: { page: "folder" |
// "added" | "confirm-delete" | "overview", folderId, message, title, already (for "added": the
// title was in the folder already), structural (the folder rows changed) }.
'use strict';

const stremio = require('./stremio-api');
const { ID_PREFIX, LIMITS, NO_ICON, isColor, colorOf, toLibraryItems, deletionItems, settingsItems } = require('./shared');
const { ICONS } = require('./images');
const { decodeText, splitTitle } = require('./addon');

const OUT_OF_DATE = 'This page was out of date, so nothing was changed. This is how things are now.';

const HELP = {
  new: 'To create a folder, search for "new folder: " followed by its name, and open the card.',
  rename: 'To rename a folder, search for "rename <folder name>: <new name>", and open the card.',
  describe: 'To describe a folder, search for "describe <folder name>: <description>", and open the card.'
};

async function runAction(authKey, action, { baseUrl }) {
  return stremio.editLibrary(authKey, async ({ folders, settings, previous }) => {
    const now = Date.now();
    const folder = folders.find((f) => f.id === action.folderId);
    // Edited folders get a new version, which makes links from older pages out of date.
    const save = (...edited) => edited.flatMap((f) => toLibraryItems({ ...f, version: now }, { baseUrl, previous }));
    const show = (message, changes = [], extra = {}) => ({ page: 'folder', folderId: action.folderId, message, changes, ...extra });
    const overview = (message, changes = [], extra = {}) => ({ page: 'overview', message, changes, ...extra });

    if (action.verb === 'help') return overview(HELP[action.arg] || HELP.new);

    if (action.verb === 'library') {
      if (action.version !== settings.version) return overview(OUT_OF_DATE);
      const shown = action.arg === 'on';
      return overview(
        shown
          ? '✓ Your folders show in your Stremio Library again, next to your movies and shows.'
          : '✓ Your folders are hidden from your Stremio Library. Find them on the Board, in Discover under the type "Folder", or by searching.',
        settingsItems({ library: shown }, { previous })
      );
    }

    if (action.verb === 'new' || action.verb === 'new-with') {
      // Opening the same card twice doesn't make a second folder.
      if (previous.has(ID_PREFIX + action.folderId)) {
        return folder ? show('This folder already exists.') : overview("This folder doesn't exist anymore.");
      }
      const name = action.verb === 'new' ? decodeText(action.arg).trim().slice(0, LIMITS.name) : 'New folder';
      if (!name) return overview(HELP.new);
      const ref = action.verb === 'new-with' && splitTitle(action.arg);
      const title = ref ? await stremio.describeTitle(authKey, ref.type, ref.id) : null;
      const created = {
        id: action.folderId,
        name,
        description: '',
        color: null,
        icon: 'folder',
        order: folders.reduce((max, f) => Math.max(max, f.order + 1), 0),
        items: title ? [title] : []
      };
      return show(
        title
          ? `✓ Created "${name}" with "${title.name}" in it. Use "Rename" below to name it.`
          : `✓ Created "${name}". To add a movie or show, open it and pick this folder in its list of streams.`,
        save(created),
        { structural: true, title }
      );
    }

    if (!folder) return overview("This folder doesn't exist anymore.");

    if (action.verb === 'add') {
      // Adding is safe to repeat, so it works from any page. Titles are taken out of folders on
      // the configure page.
      const ref = splitTitle(action.arg);
      if (!ref) return show('Something is missing from this link.');
      const added = (message, changes, title, already) => ({ page: 'added', folderId: folder.id, message, changes, title, already });
      const existing = folder.items.find((item) => item.id === ref.id);
      if (existing) return added(`"${existing.name}" was already in "${folder.name}".`, [], existing, true);
      if (folder.items.length >= LIMITS.items) return show(`A folder can hold up to ${LIMITS.items} titles.`);
      const title = await stremio.describeTitle(authKey, ref.type, ref.id);
      return added(`✓ Added "${title.name}" to "${folder.name}".`, save({ ...folder, items: folder.items.concat(title) }), title, false);
    }

    // The rest change the folder itself, so they only apply to the version they were made for.
    if (action.version !== folder.version) return show(OUT_OF_DATE);
    switch (action.verb) {
      case 'color': {
        const color = action.arg === 'none' ? null : action.arg;
        if (color !== null && !isColor(color)) return show('That color is not available.');
        return show(`✓ Color changed to ${colorOf(color).label.toLowerCase()}.`, save({ ...folder, color }), { structural: true });
      }
      case 'icon': {
        if (action.arg === NO_ICON) return show('✓ Icon removed.', save({ ...folder, icon: NO_ICON }));
        if (!Object.prototype.hasOwnProperty.call(ICONS, action.arg)) return show('That icon is not available.');
        return show(`✓ Icon changed to ${ICONS[action.arg].label.toLowerCase()}.`, save({ ...folder, icon: action.arg }));
      }
      case 'rename': {
        const name = decodeText(action.arg).trim().slice(0, LIMITS.name);
        if (!name) return show(HELP.rename);
        return show(`✓ Renamed to "${name}".`, save({ ...folder, name }), { structural: true });
      }
      case 'describe':
        return show('✓ Description saved.', save({ ...folder, description: decodeText(action.arg).trim().slice(0, LIMITS.description) }));
      case 'up':
      case 'down': {
        const order = folders.slice();
        const from = order.indexOf(folder);
        const to = action.verb === 'up' ? from - 1 : from + 1;
        if (to < 0 || to >= order.length) return show(`This folder is already ${action.verb === 'up' ? 'first' : 'last'}.`);
        [order[from], order[to]] = [order[to], order[from]];
        const moved = order.map((f, index) => (f.order === index ? null : { ...f, order: index })).filter(Boolean);
        return show(`✓ Moved ${action.verb}.`, save(...moved), { structural: true });
      }
      case 'delete':
        return { page: 'confirm-delete', folderId: folder.id, message: '' };
      case 'delete-now':
        return overview(`✓ Deleted "${folder.name}".`, deletionItems(folder.id, { previous }), { structural: true });
      default:
        return show('S-library does not know this link. Is the addon up to date?');
    }
  });
}

module.exports = { runAction };
