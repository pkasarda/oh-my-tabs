import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupName, groupChain, rollUp, duplicateKey, findDuplicates, staleTabs, planSave, isNeverListed, neverEntry, reminderTimes, withReminders, withoutReminder } from './rules.js';

const DEV = true;
const PLAIN = false;

function sameTab(a, b, dev = DEV) {
  return duplicateKey(a, dev) === duplicateKey(b, dev);
}

test('generic duplicate key ignores hash, utm_* params, param order and a trailing slash', () => {
  assert.ok(sameTab('https://example.com/docs#intro', 'https://example.com/docs', PLAIN));
  assert.ok(sameTab('https://web.dev/articles/popover-api?utm_source=x&utm_medium=email', 'https://web.dev/articles/popover-api', PLAIN));
  assert.ok(sameTab('https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2', PLAIN));
  assert.ok(sameTab('https://example.com/docs/', 'https://example.com/docs', PLAIN));
  assert.equal(duplicateKey('https://example.com/', PLAIN), 'https://example.com/');
});

test('a hash that looks like an app route is kept, plain anchors are dropped', () => {
  assert.ok(!sameTab('https://mail.google.com/mail/u/0/#inbox/AAA', 'https://mail.google.com/mail/u/0/#inbox/BBB', PLAIN));
  assert.ok(!sameTab('https://app.example.com/#/settings', 'https://app.example.com/#/billing', PLAIN));
  assert.ok(!sameTab('https://example.com/#!/a', 'https://example.com/#!/b', PLAIN));
  assert.ok(sameTab('https://github.com/a/b/blob/main/x.js#L10-L20', 'https://github.com/a/b/blob/main/x.js', PLAIN));
  assert.ok(sameTab('https://example.com/docs#intro', 'https://example.com/docs#usage', PLAIN));
});

test('malformed web URLs never throw', () => {
  assert.equal(duplicateKey('http://[::1', DEV), null);
  assert.equal(groupName('http://[::1', DEV), 'Browser');
  assert.deepEqual(findDuplicates([{ id: 1, url: 'http://[::1', lastAccessed: 1 }, { id: 2, url: 'http://[::1', lastAccessed: 2 }], DEV), []);
});

test('group names keep a non-default port', () => {
  assert.equal(groupName('http://localhost:3000/', PLAIN), 'localhost:3000');
  assert.equal(groupName('http://localhost:5173/app', DEV), 'localhost:5173');
  assert.equal(groupName('https://example.com:443/', PLAIN), 'example.com');
});

test('generic duplicate key keeps every other query parameter', () => {
  assert.ok(!sameTab('https://www.google.com/search?q=foo', 'https://www.google.com/search?q=bar', PLAIN));
});

test('system tabs have no duplicate key and group under Browser', () => {
  assert.equal(duplicateKey('chrome://newtab/', DEV), null);
  assert.equal(duplicateKey('about:blank', DEV), null);
  assert.equal(groupName('chrome://extensions/', DEV), 'Browser');
  assert.equal(groupName('file:///Users/me/notes.txt', PLAIN), 'Browser');
});

test('generic group name is the hostname without www', () => {
  assert.equal(groupName('https://www.youtube.com/watch?v=1', PLAIN), 'youtube.com');
  assert.equal(groupName('https://github.com/pkasarda/oh-my-tabs', PLAIN), 'github.com');
});

test('GitHub groups by owner/repo, owner or github.com', () => {
  assert.equal(groupName('https://github.com/pkasarda/oh-my-tabs/pull/3/files', DEV), 'pkasarda/oh-my-tabs');
  assert.equal(groupName('https://github.com/pkasarda', DEV), 'pkasarda');
  assert.equal(groupName('https://github.com/orgs/acme/repositories', DEV), 'acme');
  assert.equal(groupName('https://github.com/notifications', DEV), 'github.com');
  assert.equal(groupName('https://github.com/pulls', DEV), 'github.com');
  assert.equal(groupName('https://github.com/', DEV), 'github.com');
});

test('GitHub pull request subpages are the same tab, only in developer mode', () => {
  const pr = 'https://github.com/pkasarda/oh-my-tabs/pull/3';
  assert.ok(sameTab(pr, `${pr}/files`));
  assert.ok(sameTab(pr, `${pr}/changes`));
  assert.ok(sameTab(pr, `${pr}/commits#diff-1`));
  assert.ok(!sameTab(pr, `${pr}/files`, PLAIN));
  assert.ok(!sameTab(pr, 'https://github.com/pkasarda/oh-my-tabs/pull/4'));
  assert.ok(sameTab('https://github.com/pkasarda/oh-my-tabs/issues/1#issuecomment-1', 'https://github.com/pkasarda/oh-my-tabs/issues/1'));
});

test('GitLab groups by the path before /-/ and collapses merge request subpages', () => {
  const mr = 'https://gitlab.com/group/sub/project/-/merge_requests/12';
  assert.equal(groupName(`${mr}/diffs`, DEV), 'group/sub/project');
  assert.equal(groupName('https://gitlab.com/group/project', DEV), 'group/project');
  assert.ok(sameTab(mr, `${mr}/diffs`));
  assert.ok(sameTab(mr, `${mr}/pipelines`));
});

test('Bitbucket groups by workspace/repo and collapses pull request subpages', () => {
  const pr = 'https://bitbucket.org/acme/api/pull-requests/7';
  assert.equal(groupName(`${pr}/diff`, DEV), 'acme/api');
  assert.ok(sameTab(pr, `${pr}/diff`));
});

test('Linear groups by team and ignores the issue slug', () => {
  assert.equal(groupName('https://linear.app/acme/issue/OMT-12/dedupe-ignores-hash', DEV), 'Linear · OMT');
  assert.equal(groupName('https://linear.app/acme/team/OMT/active', DEV), 'Linear · OMT');
  assert.equal(groupName('https://linear.app/acme/inbox', DEV), 'Linear · acme');
  assert.ok(sameTab('https://linear.app/acme/issue/OMT-12/dedupe-ignores-hash', 'https://linear.app/acme/issue/OMT-12/dedupe-ignores-hash-in-urls'));
});

test('Jira groups by project key and treats ?selectedIssue as the issue', () => {
  assert.equal(groupName('https://acme.atlassian.net/browse/PAY-1421', DEV), 'Jira · PAY');
  assert.equal(groupName('https://acme.atlassian.net/jira/software/projects/PAY/boards/12?selectedIssue=PAY-1421', DEV), 'Jira · PAY');
  assert.equal(groupName('https://acme.atlassian.net/jira/software/projects/PAY/boards/12', DEV), 'Jira · PAY');
  assert.ok(sameTab('https://acme.atlassian.net/browse/PAY-1421', 'https://acme.atlassian.net/jira/software/projects/PAY/boards/12?selectedIssue=PAY-1421'));
  assert.ok(sameTab('https://acme.atlassian.net/browse/PAY-1421', 'https://acme.atlassian.net/browse/PAY-1421?focusedCommentId=99'));
  assert.ok(!sameTab('https://acme.atlassian.net/browse/PAY-1421', 'https://acme.atlassian.net/browse/PAY-1388'));
  assert.equal(groupName('https://acme.atlassian.net/browse/pay-1421', DEV), 'Jira · PAY');
  assert.ok(sameTab('https://acme.atlassian.net/browse/pay-1421', 'https://acme.atlassian.net/browse/PAY-1421'));
});

test('self-hosted Jira (jira.* hosts) follows the same rules', () => {
  assert.equal(groupName('https://jira.acme.com/browse/PAY-1421', DEV), 'Jira · PAY');
  assert.equal(groupName('https://jira.acme.com/secure/RapidBoard.jspa?rapidView=12&selectedIssue=PAY-1421', DEV), 'Jira · PAY');
  assert.equal(groupName('https://jira.acme.com/projects/PAY/issues/PAY-1421?filter=allopenissues', DEV), 'Jira · PAY');
  assert.ok(sameTab('https://jira.acme.com/browse/PAY-1421', 'https://jira.acme.com/secure/RapidBoard.jspa?rapidView=12&selectedIssue=PAY-1421'));
  assert.ok(sameTab('https://jira.acme.com/browse/PAY-1421', 'https://jira.acme.com/projects/PAY/issues/PAY-1421?filter=allopenissues'));
  assert.ok(sameTab('https://jira.acme.com/browse/PAY-1421', 'https://jira.acme.com/browse/PAY-1421?focusedCommentId=5'));
  assert.equal(groupName('https://jira.acme.com/browse/PAY-1421', PLAIN), 'jira.acme.com');
});

test('Confluence groups by space and ignores the page slug', () => {
  const page = 'https://acme.atlassian.net/wiki/spaces/PAY/pages/123456/Release+process';
  assert.equal(groupName(page, DEV), 'Confluence · PAY');
  assert.ok(sameTab(page, 'https://acme.atlassian.net/wiki/spaces/PAY/pages/123456/Release+process+v2'));
});

test('Figma treats different node-ids of one file as the same tab', () => {
  assert.equal(groupName('https://www.figma.com/design/AbC123/oh-my-tabs?node-id=1-2', DEV), 'figma.com');
  assert.ok(sameTab('https://www.figma.com/design/AbC123/oh-my-tabs?node-id=1-2', 'https://www.figma.com/design/AbC123/oh-my-tabs?node-id=4-7'));
  assert.ok(!sameTab('https://www.figma.com/design/AbC123/x', 'https://www.figma.com/design/ZzZ999/x'));
});

test('Google Docs treats /edit, /view, ?tab= and #gid of one document as the same tab', () => {
  const doc = 'https://docs.google.com/document/d/1xYz/edit';
  assert.ok(sameTab(doc, 'https://docs.google.com/document/d/1xYz/view'));
  assert.ok(sameTab(doc, 'https://docs.google.com/document/d/1xYz/edit?tab=t.0'));
  assert.ok(sameTab('https://docs.google.com/spreadsheets/d/9abc/edit#gid=0', 'https://docs.google.com/spreadsheets/d/9abc/edit#gid=5'));
  assert.ok(!sameTab(doc, 'https://docs.google.com/document/d/2other/edit'));
});

test('Slite ignores the doc slug, also on workspace subdomains', () => {
  assert.ok(sameTab('https://slite.com/app/docs/aB12/Onboarding-checklist', 'https://slite.com/app/docs/aB12/Onboarding-checklist-v2'));
  assert.ok(sameTab('https://acme.slite.com/app/docs/aB12/Onboarding-checklist', 'https://acme.slite.com/app/docs/aB12/Onboarding-v2'));
  assert.ok(!sameTab('https://acme.slite.com/app/docs/aB12/x', 'https://acme.slite.com/app/docs/cD34/x'));
});

test('findDuplicates keeps the most recently used tab of each set', () => {
  const tabs = [
    { id: 1, url: 'https://github.com/a/b/pull/3', lastAccessed: 10 },
    { id: 2, url: 'https://github.com/a/b/pull/3/files', lastAccessed: 30 },
    { id: 3, url: 'https://github.com/a/b/pull/3/changes', lastAccessed: 20 },
    { id: 4, url: 'https://github.com/a/b', lastAccessed: 5 },
  ];
  const sets = findDuplicates(tabs, DEV);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].keeper.id, 2);
  assert.deepEqual(sets[0].copies.map(t => t.id).sort(), [1, 3]);
  assert.equal(findDuplicates(tabs, PLAIN).length, 0);
});

test('findDuplicates never matches private tabs with normal tabs, nor system tabs', () => {
  const tabs = [
    { id: 1, url: 'https://example.com/', lastAccessed: 1 },
    { id: 2, url: 'https://example.com/', lastAccessed: 2, incognito: true },
    { id: 3, url: 'chrome://newtab/', lastAccessed: 3 },
    { id: 4, url: 'chrome://newtab/', lastAccessed: 4 },
  ];
  assert.equal(findDuplicates(tabs, DEV).length, 0);
});

test('findDuplicates keeps Firefox containers apart', () => {
  const tabs = [
    { id: 1, url: 'https://github.com/', lastAccessed: 1, cookieStoreId: 'firefox-container-1' },
    { id: 2, url: 'https://github.com/', lastAccessed: 2, cookieStoreId: 'firefox-container-2' },
    { id: 3, url: 'https://github.com/', lastAccessed: 3, cookieStoreId: 'firefox-container-2' },
  ];
  const sets = findDuplicates(tabs, DEV);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].copies.map(t => t.id), [2]);
});

test('findDuplicates uses pendingUrl while a tab is still loading', () => {
  const tabs = [
    { id: 1, url: 'https://example.com/a', lastAccessed: 1 },
    { id: 2, url: '', pendingUrl: 'https://example.com/a', lastAccessed: 2 },
  ];
  assert.equal(findDuplicates(tabs, DEV).length, 1);
});

const DAY = 24 * 60 * 60 * 1000;

test('staleTabs: unpinned web tabs not used for longer than the threshold', () => {
  const now = 100 * DAY;
  const tabs = [
    { id: 1, url: 'https://a.example/', lastAccessed: now - 8 * DAY },
    { id: 2, url: 'https://b.example/', lastAccessed: now - 2 * DAY },
    { id: 3, url: 'https://c.example/', lastAccessed: now - 30 * DAY, pinned: true },
    { id: 4, url: 'chrome://newtab/', lastAccessed: now - 30 * DAY },
    { id: 5, url: 'https://d.example/', lastAccessed: now - 7 * DAY - 1 },
  ];
  assert.deepEqual(staleTabs(tabs, now, 7).map(t => t.id), [1, 5]);
});

test('planSave: a new tab becomes a bookmark with the chosen topic', () => {
  const plan = planSave([], [{ url: 'https://example.com/a', title: 'A' }], DEV, 'Read later');
  assert.deepEqual(plan, { remove: [], create: [{ url: 'https://example.com/a', title: 'A', topic: 'Read later' }] });
});

test('planSave: saving again replaces the saved tab with the same duplicate key and keeps its topic', () => {
  const saved = [{ id: 'b1', url: 'https://github.com/a/b/pull/3', topic: 'Release' }];
  const plan = planSave(saved, [{ url: 'https://github.com/a/b/pull/3/files', title: 'PR 3' }], DEV, null);
  assert.deepEqual(plan, { remove: ['b1'], create: [{ url: 'https://github.com/a/b/pull/3/files', title: 'PR 3', topic: 'Release' }] });
});

test('planSave: an explicit topic wins over the old one', () => {
  const saved = [{ id: 'b1', url: 'https://example.com/a', topic: 'Old' }];
  assert.equal(planSave(saved, [{ url: 'https://example.com/a#x', title: 'A' }], DEV, 'New').create[0].topic, 'New');
});

test('planSave: duplicates among the tabs are saved once; system tabs are skipped', () => {
  const tabs = [
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/a#section', title: 'A again' },
    { url: 'chrome://extensions/', title: 'Extensions' },
  ];
  const plan = planSave([], tabs, DEV, null);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].url, 'https://example.com/a');
});

test('groupChain goes from the most specific group to the site', () => {
  assert.deepEqual(groupChain('https://github.com/acme/client/pull/3', DEV), ['acme/client', 'acme', 'github.com']);
  assert.deepEqual(groupChain('https://github.com/acme', DEV), ['acme', 'github.com']);
  assert.deepEqual(groupChain('https://gitlab.com/acme/infra/-/merge_requests/5', DEV), ['acme/infra', 'acme', 'gitlab.com']);
  assert.deepEqual(groupChain('https://linear.app/acme/issue/WEB-1/x', DEV), ['Linear · WEB', 'Linear · acme', 'linear.app']);
  assert.deepEqual(groupChain('https://acme.atlassian.net/browse/PAY-1', DEV), ['Jira · PAY', 'acme.atlassian.net', 'atlassian.net']);
  assert.deepEqual(groupChain('https://example.com/a', DEV), ['example.com']);
  assert.deepEqual(groupChain('https://github.com/acme/client', PLAIN), ['github.com']);
  assert.deepEqual(groupChain('chrome://newtab/', DEV), ['Browser']);
});

test('rollUp moves lone tabs up until they have company', () => {
  const chains = {
    a: ['acme/client', 'acme', 'github.com'],
    b: ['acme/client', 'acme', 'github.com'],
    c: ['acme/web', 'acme', 'github.com'],
    d: ['acme/sdk', 'acme', 'github.com'],
    e: ['foo/x', 'foo', 'github.com'],
    f: ['bar/y', 'bar', 'github.com'],
    g: ['example.com'],
  };
  const groups = rollUp(Object.keys(chains), id => chains[id]);
  assert.deepEqual(Object.fromEntries(Object.keys(chains).map(id => [id, groups.get(id)])), {
    a: 'acme/client', b: 'acme/client',  // two tabs: the repo stays
    c: 'acme', d: 'acme',                // lone repos of one owner share the owner
    e: 'github.com', f: 'github.com',    // lone owners share the site
    g: 'example.com',                    // nowhere higher to go: stays a lone tab
  });
});

test('rollUp: a lone tab joins an existing group of the next level', () => {
  const chains = { a: ['github.com'], b: ['github.com'], c: ['foo/x', 'foo', 'github.com'] };
  const groups = rollUp(Object.keys(chains), id => chains[id]);
  assert.equal(groups.get('c'), 'github.com');
});

test('groupChain ends with the domain, so lone subdomains of one site meet', () => {
  assert.deepEqual(groupChain('https://acme.slack.com/marketplace', PLAIN), ['acme.slack.com', 'slack.com']);
  assert.deepEqual(groupChain('https://api.slack.com/apps', DEV), ['api.slack.com', 'slack.com']);
  assert.deepEqual(groupChain('https://www.bbc.co.uk/news', PLAIN), ['bbc.co.uk']);
  assert.deepEqual(groupChain('https://shop.bbc.co.uk/', PLAIN), ['shop.bbc.co.uk', 'bbc.co.uk']);
  // Hosting domains: every site on them belongs to someone else.
  assert.deepEqual(groupChain('https://alice.github.io/blog', PLAIN), ['alice.github.io']);
  assert.deepEqual(groupChain('https://my-app.vercel.app/', PLAIN), ['my-app.vercel.app']);
  // Ports and IP addresses stay as they are.
  assert.deepEqual(groupChain('http://dev.localhost:3000/', PLAIN), ['dev.localhost:3000']);
  assert.deepEqual(groupChain('http://192.168.1.10/admin', PLAIN), ['192.168.1.10']);
});

test('rollUp with domains: lone slack.com subdomains share slack.com', () => {
  const urls = ['https://acme.slack.com/a', 'https://app.slack.com/b', 'https://api.slack.com/c', 'https://example.org/'];
  const groups = rollUp(urls, url => groupChain(url, DEV));
  assert.deepEqual(urls.map(url => groups.get(url)), ['slack.com', 'slack.com', 'slack.com', 'example.org']);
});

test('never list: an entry covers its host and every subdomain', () => {
  const never = ['slack.com', 'app.example.org'];
  assert.ok(isNeverListed('https://slack.com/', never));
  assert.ok(isNeverListed('https://acme.slack.com/messages', never));
  assert.ok(isNeverListed('https://app.example.org/x', never));
  assert.ok(isNeverListed('https://eu.app.example.org/x', never));
  assert.ok(!isNeverListed('https://example.org/', never));
  assert.ok(!isNeverListed('https://notslack.com/', never));
  assert.ok(!isNeverListed('chrome://newtab/', never));
});

test('never list: entries are cleaned up from whatever was typed or pasted', () => {
  assert.equal(neverEntry('  https://www.Slack.com/messages?x=1 '), 'slack.com');
  assert.equal(neverEntry('app.example.org'), 'app.example.org');
  assert.equal(neverEntry('*.example.org'), 'example.org');
  assert.equal(neverEntry('not a host'), null);
  assert.equal(neverEntry(''), null);
});

test('staleTabs skips audible tabs and never-listed sites', () => {
  const now = 100 * DAY;
  const tabs = [
    { id: 1, url: 'https://a.example/', lastAccessed: now - 9 * DAY },
    { id: 2, url: 'https://music.example/', lastAccessed: now - 9 * DAY, audible: true },
    { id: 3, url: 'https://app.slack.com/', lastAccessed: now - 9 * DAY },
  ];
  assert.deepEqual(staleTabs(tabs, now, 7, ['slack.com']).map(t => t.id), [1]);
});

// ---------- reminders ----------
// Local times, so the tests hold in any time zone.
function local(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function times(now) {
  return Object.fromEntries(reminderTimes(now));
}

test('reminder times: the four presets, in the order the menu shows them', () => {
  // A Thursday afternoon.
  const now = local(2026, 11, 12, 14, 30);
  assert.deepEqual(reminderTimes(now), [
    ['In 1 hour', local(2026, 11, 12, 15, 30)],
    ['In 3 hours', local(2026, 11, 12, 17, 30)],
    ['Tomorrow 9:00', local(2026, 11, 13, 9)],
    ['Next Monday 9:00', local(2026, 11, 16, 9)],
  ]);
});

test('reminder times: Tomorrow 9:00 is the next day even before 9:00 today', () => {
  assert.equal(times(local(2026, 11, 12, 7))['Tomorrow 9:00'], local(2026, 11, 13, 9));
});

test('reminder times: Next Monday is the first Monday after today, a week away on a Monday', () => {
  const monday = local(2026, 11, 23, 9);
  // Monday the 16th, before and after 9:00: never today.
  assert.equal(times(local(2026, 11, 16, 8))['Next Monday 9:00'], monday);
  assert.equal(times(local(2026, 11, 16, 10))['Next Monday 9:00'], monday);
  // Tuesday to Sunday of that week.
  for (let day = 17; day <= 22; day++) assert.equal(times(local(2026, 11, day, 12))['Next Monday 9:00'], monday);
  // On a Sunday it is the same moment as Tomorrow 9:00.
  assert.equal(times(local(2026, 11, 22, 12))['Tomorrow 9:00'], monday);
});

test('reminder times: across the end of a month and of a year', () => {
  assert.equal(times(local(2026, 11, 30, 18))['Tomorrow 9:00'], local(2026, 12, 1, 9));
  // 31 December 2026 is a Thursday.
  assert.equal(times(local(2026, 12, 31, 23, 59))['Tomorrow 9:00'], local(2027, 1, 1, 9));
  assert.equal(times(local(2026, 12, 31, 23, 59))['Next Monday 9:00'], local(2027, 1, 4, 9));
});

test('reminder times: 9:00 stays 9:00 across a clock change', t => {
  const zone = process.env.TZ;
  t.after(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  // Clocks go back on Sunday 25 October 2026 (a 25-hour day) and forward on Sunday 28 March 2027 (23 hours).
  process.env.TZ = 'Europe/Bratislava';
  const HOUR = 60 * 60 * 1000;
  for (const [saturday, hours] of [[local(2026, 10, 24, 20), 14], [local(2027, 3, 27, 20), 12]]) {
    const tomorrow = times(saturday)['Tomorrow 9:00'];
    assert.equal(new Date(tomorrow).getHours(), 9);
    // 13 hours on the clock from 20:00 to 9:00; one more or one fewer really pass.
    assert.equal(tomorrow - saturday, hours * HOUR);
    assert.equal(new Date(times(saturday)['Next Monday 9:00']).getHours(), 9);
    // The hour presets count real hours.
    assert.equal(times(saturday)['In 3 hours'] - saturday, 3 * HOUR);
  }
  // Tomorrow is the next date, not 24 hours on. Half past midnight on the 25-hour Sunday plus 24 hours is still
  // that Sunday; half past eleven before the 23-hour Sunday plus 24 hours is already Monday.
  assert.equal(times(local(2026, 10, 25, 0, 30))['Tomorrow 9:00'], local(2026, 10, 26, 9));
  assert.equal(times(local(2027, 3, 27, 23, 30))['Tomorrow 9:00'], local(2027, 3, 28, 9));
});

test('withReminders keeps the address, the title and the time, one per page', () => {
  const pages = [
    { url: 'https://github.com/acme/client/pull/12', title: 'Fix login' },
    // The same pull request on another of its pages: the same page in developer mode.
    { url: 'https://github.com/acme/client/pull/12/files', title: 'Files changed' },
    { url: 'https://docs.example.org/guide', title: '' },
    // Not a web page: nothing to come back to by address.
    { url: 'chrome://extensions/', title: 'Extensions' },
    // A private window's tab: its address is not written down.
    { url: 'https://private.example/', title: 'Private', incognito: true },
  ];
  assert.deepEqual(withReminders([], pages, 500, DEV), [
    { url: 'https://github.com/acme/client/pull/12', title: 'Fix login', at: 500 },
    { url: 'https://docs.example.org/guide', title: 'https://docs.example.org/guide', at: 500 },
  ]);
  // Without developer mode the two addresses are two pages.
  assert.equal(withReminders([], pages, 500, PLAIN).length, 3);
});

test('withReminders replaces the reminder a page already has and leaves the others', () => {
  const before = [
    { url: 'https://docs.example.org/guide#intro', title: 'Guide', at: 100 },
    { url: 'https://docs.example.org/api', title: 'API', at: 200 },
  ];
  const after = withReminders(before, [{ url: 'https://docs.example.org/guide', title: 'Guide' }], 900, DEV);
  assert.deepEqual(after, [
    { url: 'https://docs.example.org/api', title: 'API', at: 200 },
    { url: 'https://docs.example.org/guide', title: 'Guide', at: 900 },
  ]);
  // The list given is not changed.
  assert.equal(before.length, 2);
  assert.equal(before[0].at, 100);
});

test('withoutReminder drops the reminder of that page, whichever of its addresses is given', () => {
  const reminders = [
    { url: 'https://docs.example.org/guide', title: 'Guide', at: 100 },
    { url: 'https://docs.example.org/api', title: 'API', at: 200 },
  ];
  assert.deepEqual(withoutReminder(reminders, 'https://docs.example.org/guide/?utm_source=mail#intro', DEV), [reminders[1]]);
  assert.deepEqual(withoutReminder(reminders, 'https://docs.example.org/other', DEV), reminders);
});

test('staleTabs keeps a tab whose page has a scheduled reminder; a due one no longer holds it', () => {
  const now = 100 * DAY;
  const old = now - 9 * DAY;
  const tabs = [
    { id: 1, url: 'https://a.example/', lastAccessed: old },
    { id: 2, url: 'https://b.example/page#intro', lastAccessed: old },
    { id: 3, url: 'https://c.example/', lastAccessed: old },
  ];
  const reminders = [
    { url: 'https://b.example/page', title: 'B', at: now + DAY },
    { url: 'https://c.example/', title: 'C', at: now - DAY },
  ];
  assert.deepEqual(staleTabs(tabs, now, 7, [], reminders, DEV).map(t => t.id), [1, 3]);
  assert.deepEqual(staleTabs(tabs, now, 7, [], [], DEV).map(t => t.id), [1, 2, 3]);
});
