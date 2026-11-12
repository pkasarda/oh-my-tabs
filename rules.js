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

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// For matching site rules: the hostname without www.
function hostOf(u) {
  return u.hostname.replace(/^www\./, '');
}

// For showing: also keeps a non-default port, so localhost:3000 and localhost:5173 stay apart.
function hostLabel(u) {
  return u.host.replace(/^www\./, '');
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
  let key = null;
  if (selected) key = selected;
  else if (parts[0] === 'browse') key = parts[1];
  // Self-hosted: /projects/PAY/issues/PAY-1421
  else if (parts[0] === 'projects' && parts[2] === 'issues') key = parts[3];
  // Jira treats keys case-insensitively: pay-1421 is PAY-1421.
  return key ? key.toUpperCase() : null;
}

function siteGroupName(u) {
  const host = hostOf(u);
  const label = hostLabel(u);
  const parts = pathParts(u);

  if (host === 'github.com') {
    if (parts.length === 0 || RESERVED_GITHUB.has(parts[0])) return label;
    if (parts[0] === 'orgs') return parts[1] ?? label;
    if (parts.length === 1) return parts[0];
    return `${parts[0]}/${parts[1]}`;
  }
  if (host === 'gitlab.com') {
    const end = parts.indexOf('-');
    const project = end === -1 ? parts : parts.slice(0, end);
    return project.length > 0 ? project.join('/') : label;
  }
  if (host === 'bitbucket.org') {
    if (parts.length < 2) return label;
    return `${parts[0]}/${parts[1]}`;
  }
  if (host === 'linear.app') {
    if (parts[1] === 'issue' && parts[2]) return `Linear · ${parts[2].split('-')[0]}`;
    if (parts[1] === 'team' && parts[2]) return `Linear · ${parts[2]}`;
    return parts[0] ? `Linear · ${parts[0]}` : label;
  }
  if (isConfluence(host, parts)) {
    if (parts[1] === 'spaces' && parts[2]) return `Confluence · ${parts[2]}`;
    return label;
  }
  if (isJira(host, parts)) {
    const key = jiraKey(u, parts);
    if (key) return `Jira · ${key.split('-')[0]}`;
    const projects = parts.indexOf('projects');
    if (projects !== -1 && parts[projects + 1]) return `Jira · ${parts[projects + 1]}`;
    return label;
  }
  return label;
}

export function groupName(url, dev) {
  const u = isWeb(url) ? parse(url) : null;
  if (!u) return 'Browser';
  if (!dev) return hostLabel(u);
  return siteGroupName(u);
}

const OWNER_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

// The level above a site group: the owner of a repository, the workspace of a Linear team.
function ownerGroup(u, group) {
  const host = hostOf(u);
  if (OWNER_HOSTS.has(host) && group.includes('/')) return group.split('/')[0];
  const workspace = pathParts(u)[0];
  if (host === 'linear.app' && workspace) return `Linear · ${workspace}`;
  return null;
}

// Two-part public suffixes (bbc.co.uk is one site) and hosting domains whose subdomains are different people's sites.
// ponytail: a short list, not the full Public Suffix List; add an entry when a site rolls up wrongly.
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'com.br',
  'com.cn', 'com.hk', 'com.sg', 'co.in', 'co.za', 'com.mx', 'com.tr', 'com.pl', 'co.kr', 'co.il',
]);
const HOSTING_DOMAINS = new Set([
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app',
  'firebaseapp.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'blogspot.com', 'wordpress.com',
  'substack.com', 'notion.site', 'glitch.me', 'onrender.com', 'fly.dev',
]);

// The site a host belongs to: acme.slack.com → slack.com. Null for IPs, ports, localhost and hosting domains.
function domainOf(u) {
  const host = u.hostname;
  if (u.port || /^[\d.]+$/.test(host) || host.startsWith('[') || !host.includes('.')) return null;
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  if (HOSTING_DOMAINS.has(lastTwo)) return null;
  const size = TWO_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.length > size ? labels.slice(-size).join('.') : null;
}

// The groups a URL belongs to, from the most specific to the site: acme/client → acme → github.com,
// acme.slack.com → slack.com.
export function groupChain(url, dev) {
  const u = isWeb(url) ? parse(url) : null;
  if (!u) return ['Browser'];
  const site = hostLabel(u);
  const levels = dev ? [siteGroupName(u)] : [];
  if (dev) levels.push(ownerGroup(u, levels[0]));
  levels.push(site, domainOf(u));
  return [...new Set(levels.filter(Boolean))];
}

// Picks each item's group: a tab that would be alone in its group moves up its chain until it shares
// a group with another tab, or the chain ends. Returns Map(item → group name).
export function rollUp(items, chainOf) {
  const chains = new Map(items.map(item => [item, chainOf(item)]));
  const level = new Map(items.map(item => [item, 0]));
  const nameOf = item => chains.get(item)[level.get(item)];
  for (let changed = true; changed;) {
    changed = false;
    const counts = new Map();
    for (const item of items) counts.set(nameOf(item), (counts.get(nameOf(item)) ?? 0) + 1);
    for (const item of items) {
      const alone = counts.get(nameOf(item)) === 1;
      if (alone && level.get(item) < chains.get(item).length - 1) {
        level.set(item, level.get(item) + 1);
        changed = true;
      }
    }
  }
  return new Map(items.map(item => [item, nameOf(item)]));
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

// A hash that looks like an app route (#/settings, #!/a, Gmail's #inbox/AAA) names a different page;
// a plain anchor (#intro, #L10-L20, #issuecomment-1) only scrolls the same one.
function isRouteHash(hash) {
  return hash.startsWith('#/') || hash.startsWith('#!') || hash.slice(1).includes('/');
}

export function duplicateKey(url, dev) {
  const u = isWeb(url) ? parse(url) : null;
  if (!u) return null;
  if (!isRouteHash(u.hash)) u.hash = '';
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
    // A tab that is still loading has only its pendingUrl.
    const key = duplicateKey(tab.url || tab.pendingUrl || '', dev);
    if (!key) continue;
    // Private and normal tabs never match each other, nor do tabs in different Firefox containers.
    const scopedKey = `${tab.incognito ? 'private' : 'normal'}|${tab.cookieStoreId ?? ''}|${key}`;
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

const DAY = 24 * 60 * 60 * 1000;

// The never list: sites that are never stale and never suspended in bulk. "slack.com" covers slack.com and every
// subdomain; "app.slack.com" covers that subdomain and the ones below it.
export function neverEntry(text) {
  const raw = text.trim().toLowerCase().replace(/^\*\./, '');
  if (!raw) return null;
  const u = parse(raw.includes('://') ? raw : `https://${raw}`);
  if (!u || !u.hostname.includes('.') || /\s/.test(raw)) return null;
  return u.hostname.replace(/^www\./, '');
}

export function isNeverListed(url, never) {
  const u = isWeb(url) ? parse(url) : null;
  if (!u) return false;
  const host = u.hostname.replace(/^www\./, '');
  return never.some(entry => host === entry || host.endsWith(`.${entry}`));
}

// Open web tabs last used more than `days` ago. Pinned tabs, tabs playing sound and never-listed sites are kept,
// and so is a tab whose page has a scheduled reminder: when to come back to it is already decided.
export function staleTabs(tabs, now, days, never = [], reminders = [], dev = false) {
  const cutoff = now - days * DAY;
  const scheduled = new Set(reminders.filter(reminder => reminder.at > now).map(reminder => duplicateKey(reminder.url, dev)));
  return tabs.filter(tab => !tab.pinned && !tab.audible && isWeb(tab.url ?? '') && tab.lastAccessed < cutoff
    && !isNeverListed(tab.url, never) && !scheduled.has(duplicateKey(tab.url, dev)));
}

const HOUR = 60 * 60 * 1000;

// The times Remind me later offers, as [label, time], counted from `now` in local time.
// "Next Monday" is the first Monday after today: on a Monday that is a week away.
export function reminderTimes(now) {
  const at9 = days => {
    const date = new Date(now);
    // setDate, not a number of hours: the day the clocks change has 23 or 25 of them.
    date.setDate(date.getDate() + days);
    date.setHours(9, 0, 0, 0);
    return date.getTime();
  };
  const toMonday = (8 - new Date(now).getDay()) % 7 || 7;
  return [
    ['In 1 hour', now + HOUR],
    ['In 3 hours', now + 3 * HOUR],
    ['Tomorrow 9:00', at9(1)],
    ['Next Monday 9:00', at9(toMonday)],
  ];
}

// A reminder is { url, title, at } and belongs to a page: there is one per duplicate key.
// Setting one on a page that has one already replaces it. pages: tabs, or reminders set again.
// A tab in a private window takes none: its address would be written to disk and outlive the private session.
export function withReminders(reminders, pages, at, dev) {
  const added = new Map();
  for (const page of pages) {
    if (page.incognito) continue;
    const key = duplicateKey(page.url ?? '', dev);
    if (key && !added.has(key)) added.set(key, { url: page.url, title: page.title || page.url, at });
  }
  return [...reminders.filter(reminder => !added.has(duplicateKey(reminder.url, dev))), ...added.values()];
}

// Done or opened: the page's reminder is gone.
export function withoutReminder(reminders, url, dev) {
  const key = duplicateKey(url, dev);
  return reminders.filter(reminder => duplicateKey(reminder.url, dev) !== key);
}

// What saving `tabs` to the library means, given what is saved already.
// saved: [{ id, url, topic }], tabs: [{ url, title }], topic: a name or null (keep the old topic).
// A saved tab with the same duplicate key is replaced, so the library never holds two of one page.
export function planSave(saved, tabs, dev, topic) {
  const savedByKey = new Map();
  for (const item of saved) {
    const key = duplicateKey(item.url, dev);
    if (key) savedByKey.set(key, item);
  }
  const remove = [];
  const create = [];
  const seen = new Set();
  for (const tab of tabs) {
    const key = duplicateKey(tab.url ?? '', dev);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const old = savedByKey.get(key);
    if (old) remove.push(old.id);
    create.push({ url: tab.url, title: tab.title || tab.url, topic: topic ?? old?.topic ?? null });
  }
  return { remove, create };
}
