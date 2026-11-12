// A classic script in <head>, so it runs before the first paint. storage.local only answers asynchronously,
// which would flash the default look first; popup.js keeps this synchronous copy in localStorage current.
// popup.js calls applyAppearance too, so the look has one definition.
// Without a copy (the first open, or the first after an update) the look is not guessed: the page stays
// unpainted (look-pending) until popup.js has read the settings and applies the look, which reveals it.
function applyAppearance({ font = 'fira', fontCustom = '', textSize = 'default', theme = 'auto' } = {}) {
  const root = document.documentElement;
  root.classList.remove('look-pending');
  const name = fontCustom.replace(/["\\]/g, '').trim();
  root.classList.toggle('fira', font === 'fira');
  // A name the browser does not have falls through to the system font on its own.
  if (font === 'custom' && name) root.style.setProperty('--ui-font', `"${name}", var(--sans)`);
  else root.style.removeProperty('--ui-font');
  root.style.setProperty('--step', String({ small: -1, default: 0, large: 1 }[textSize] ?? 0));
  if (theme === 'auto') root.style.removeProperty('color-scheme');
  else root.style.setProperty('color-scheme', theme);
}

try {
  const copy = JSON.parse(localStorage.getItem('appearance'));
  if (copy) applyAppearance(copy);
  else document.documentElement.classList.add('look-pending');
} catch {
  // Storage blocked or the copy unreadable: wait for popup.js as without a copy.
  document.documentElement.classList.add('look-pending');
}

// The full page's sidebar and details pane, shown or hidden: also before the first paint, from a copy of the
// settings popup.js keeps here, so a reload does not flash them. Without a copy the defaults match the CSS.
function applyPanes({ sideShown = true, detailsShown = false } = {}) {
  document.documentElement.classList.toggle('side-off', !sideShown);
  document.documentElement.classList.toggle('details-on', detailsShown);
}

try {
  applyPanes(JSON.parse(localStorage.getItem('panes')) ?? {});
} catch {
  // Storage blocked or the copy unreadable: popup.js applies the stored settings a moment later.
}
