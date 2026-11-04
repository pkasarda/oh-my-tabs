// The library: saved tabs kept as bookmarks in an "oh-my-tabs" folder in Other Bookmarks.
// Topics are its subfolders (docs/adr/0003). Everything here needs the optional "bookmarks" permission.
import { planSave } from './rules.js';

globalThis.browser ??= chrome;

const ROOT_TITLE = 'oh-my-tabs';
export const PERMISSION = { permissions: ['bookmarks'] };

// The Library feature is on exactly while the permission is granted, so there is no setting to get out of sync.
export function isEnabled() {
  return browser.permissions.contains(PERMISSION);
}

// Chrome: "Other bookmarks" (folderType "other", id "2"). Firefox: "Other Bookmarks" (id "unfiled_____").
async function otherBookmarks() {
  const [root] = await browser.bookmarks.getTree();
  const other = root.children.find(node => node.folderType === 'other' || node.id === 'unfiled_____' || node.id === '2');
  return other ?? root.children.at(-1);
}

async function rootFolder({ create }) {
  const other = await otherBookmarks();
  const children = await browser.bookmarks.getChildren(other.id);
  const found = children.find(node => !node.url && node.title === ROOT_TITLE);
  if (found || !create) return found ?? null;
  return browser.bookmarks.create({ parentId: other.id, title: ROOT_TITLE });
}

async function topicFolder(root, name) {
  if (!name) return root;
  const children = await browser.bookmarks.getChildren(root.id);
  const existing = children.find(node => !node.url && node.title === name);
  return existing ?? browser.bookmarks.create({ parentId: root.id, title: name });
}

function savedTab(node, topic) {
  return { id: node.id, url: node.url, title: node.title, dateAdded: node.dateAdded, topic };
}

// { items: [{ id, url, title, dateAdded, topic }], topics: [{ id, title }] }. Deeper folders are not topics.
export async function load() {
  const root = await rootFolder({ create: false });
  if (!root) return { items: [], topics: [] };
  const [tree] = await browser.bookmarks.getSubTree(root.id);
  const items = [];
  const topics = [];
  for (const node of tree.children ?? []) {
    if (node.url) {
      items.push(savedTab(node, null));
      continue;
    }
    topics.push({ id: node.id, title: node.title });
    for (const child of node.children ?? []) {
      if (child.url) items.push(savedTab(child, node.title));
    }
  }
  return { items, topics };
}

// Saves tabs ([{ url, title }]); topic null keeps a re-saved tab's old topic. Returns how many were saved.
export async function save(tabs, dev, topic = null) {
  const root = await rootFolder({ create: true });
  const { items } = await load();
  const plan = planSave(items, tabs, dev, topic);
  for (const id of plan.remove) await browser.bookmarks.remove(id);
  for (const entry of plan.create) {
    const parent = await topicFolder(root, entry.topic);
    await browser.bookmarks.create({ parentId: parent.id, title: entry.title, url: entry.url });
  }
  return plan.create.length;
}

export async function remove(ids) {
  for (const id of ids) await browser.bookmarks.remove(id).catch(() => {});
}

// topic null moves saved tabs out of their topic.
export async function moveToTopic(ids, topic) {
  const root = await rootFolder({ create: true });
  const parent = await topicFolder(root, topic);
  for (const id of ids) await browser.bookmarks.move(id, { parentId: parent.id });
}

export async function createTopic(name) {
  const root = await rootFolder({ create: true });
  await topicFolder(root, name);
}
