// Pure rules: URL → group name, URL → duplicate key, tabs → duplicate sets.
// Terms follow GLOSSARY.md; the site rules are the table in docs/spec.md.

const RESERVED_GITHUB = new Set([
  'settings', 'notifications', 'pulls', 'issues', 'search', 'marketplace', 'explore',
  'login', 'new', 'codespaces', 'sponsors', 'topics', 'trending', 'dashboard',
]);

const FIGMA_KINDS = new Set(['design', 'file', 'board', 'proto']);

export function isWeb(url) {
  return url.startsWith('http://') || url.startsWith('https://');
}

function hostOf(u) {
  return u.hostname.replace(/^www\./, '');
}

function pathParts(u) {
  return u.pathname.split('/').filter(Boolean);
}

function isConfluence(host, parts) {
  return host.endsWith('.atlassian.net') && parts[0] === 'wiki';
}

// Jira Cloud (*.atlassian.net outside /wiki) or self-hosted Jira on a jira.* host.
function isJira(host, parts) {
  if (host.startsWith('jira.')) return true;
  return host.endsWith('.atlassian.net') && parts[0] !== 'wiki';
}

function isSlite(host) {
  return host === 'slite.com' || host.endsWith('.slite.com');
}

function jiraKey(u, parts) {
  const selected = u.searchParams.get('selectedIssue');
  if (selected) return selected;
  if (parts[0] === 'browse') return parts[1] ?? null;
  // Self-hosted: /projects/PAY/issues/PAY-1421
  if (parts[0] === 'projects' && parts[2] === 'issues') return parts[3] ?? null;
  return null;
}

function siteGroupName(u) {
  const host = hostOf(u);
  const parts = pathParts(u);

  if (host === 'github.com') {
    if (parts.length === 0 || RESERVED_GITHUB.has(parts[0])) return host;
    if (parts[0] === 'orgs') return parts[1] ?? host;
    if (parts.length === 1) return parts[0];
    return `${parts[0]}/${parts[1]}`;
  }
  if (host === 'gitlab.com') {
    const end = parts.indexOf('-');
    const project = end === -1 ? parts : parts.slice(0, end);
    return project.length > 0 ? project.join('/') : host;
  }
  if (host === 'bitbucket.org') {
    if (parts.length < 2) return host;
    return `${parts[0]}/${parts[1]}`;
  }
  if (host === 'linear.app') {
    if (parts[1] === 'issue' && parts[2]) return `Linear · ${parts[2].split('-')[0]}`;
    if (parts[1] === 'team' && parts[2]) return `Linear · ${parts[2]}`;
    return parts[0] ? `Linear · ${parts[0]}` : host;
  }
  if (isConfluence(host, parts)) {
    if (parts[1] === 'spaces' && parts[2]) return `Confluence · ${parts[2]}`;
    return host;
  }
  if (isJira(host, parts)) {
    const key = jiraKey(u, parts);
    if (key) return `Jira · ${key.split('-')[0]}`;
    const projects = parts.indexOf('projects');
    if (projects !== -1 && parts[projects + 1]) return `Jira · ${parts[projects + 1]}`;
    return host;
  }
  return host;
}

export function groupName(url, dev) {
  if (!isWeb(url)) return 'Browser';
  const u = new URL(url);
  if (!dev) return hostOf(u);
  return siteGroupName(u);
}

// Rewrites u in place so that URLs showing the same thing on a known site become equal.
function collapseForSite(u) {
  const host = hostOf(u);
  const parts = pathParts(u);
  const keepPath = count => {
    u.pathname = '/' + parts.slice(0, count).join('/');
  };

  if (host === 'github.com' && parts[2] === 'pull' && parts.length > 4) keepPath(4);
  if (host === 'gitlab.com') {
    const mr = parts.indexOf('merge_requests');
    if (mr !== -1 && parts[mr - 1] === '-' && parts.length > mr + 2) keepPath(mr + 2);
  }
  if (host === 'bitbucket.org' && parts[2] === 'pull-requests' && parts.length > 4) keepPath(4);
  if (host === 'linear.app' && parts[1] === 'issue' && parts.length > 3) keepPath(3);
  if (isConfluence(host, parts) && parts[3] === 'pages' && parts.length > 5) keepPath(5);
  if (isJira(host, parts)) {
    const key = jiraKey(u, parts);
    if (key) {
      u.pathname = `/browse/${key}`;
      u.search = '';
    }
  }
  if (host === 'figma.com' && FIGMA_KINDS.has(parts[0])) {
    keepPath(2);
    u.search = '';
  }
  if (host === 'docs.google.com' && parts[1] === 'd') {
    keepPath(3);
    u.search = '';
  }
  if (isSlite(host) && parts[0] === 'app' && parts[1] === 'docs') keepPath(3);
}

export function duplicateKey(url, dev) {
  if (!isWeb(url)) return null;
  const u = new URL(url);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (key.startsWith('utm_')) u.searchParams.delete(key);
  }
  if (dev) collapseForSite(u);
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.href;
}

// Returns one { keeper, copies } per duplicate set. The keeper is the most recently used tab.
export function findDuplicates(tabs, dev) {
  const byKey = new Map();
  for (const tab of tabs) {
    const key = duplicateKey(tab.url, dev);
    if (!key) continue;
    // Private and normal tabs never match each other.
    const scopedKey = tab.incognito ? `private:${key}` : key;
    if (!byKey.has(scopedKey)) byKey.set(scopedKey, []);
    byKey.get(scopedKey).push(tab);
  }

  const sets = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const keeper = members.reduce((best, tab) => (tab.lastAccessed > best.lastAccessed ? tab : best));
    sets.push({ keeper, copies: members.filter(tab => tab !== keeper) });
  }
  return sets;
}
