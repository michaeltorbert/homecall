// Presentation shell around the existing controllers: the More menu, tool dialogs, disclosures,
// takeover confirmations and read-only warning mirrors. It never starts, stops or owns audio.
// Every function takes the document explicitly so tests can drive it inside any window.
const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea, summary';
const openers = new WeakMap(), dismissers = new WeakMap(), wired = new WeakSet();
const isOpen = dialog => !!dialog?.hasAttribute('open');
const shown = el => !!el?.isConnected && !el.closest('[hidden]') && !el.disabled;

// Read-only copies of the persistent warning regions. Sources marked "always" count whenever they
// have text; "flagged" sources count only while their controller marks them data-alert="on".
// Controllers remain the only writers of the warning text itself.
export function mirrorWarnings(doc) {
  const sources = [...doc.querySelectorAll('[data-warning-source]')];
  for (const target of doc.querySelectorAll('[data-warning-mirror]')) {
    const only = target.dataset.warningMirror;
    const texts = sources.filter(source => (!only || source.matches(only)) && (source.dataset.warningSource === 'always' || source.dataset.alert === 'on'))
      .map(source => source.textContent.trim()).filter(Boolean);
    const joined = texts.join('\n');
    if (target.dataset.mirrored === joined) continue;
    target.dataset.mirrored = joined;
    target.replaceChildren(...texts.map(text => { const p = doc.createElement('p'); p.textContent = text; return p; }));
  }
}

function restoreFocus(dialog) {
  const doc = dialog.ownerDocument, opener = openers.get(dialog);
  openers.delete(dialog);
  if (dialog.contains(doc.activeElement) || doc.activeElement === doc.body || !doc.activeElement) {
    (shown(opener) ? opener : doc.getElementById('more'))?.focus();
  }
}

function wireDialog(dialog) {
  if (!dialog || wired.has(dialog)) return;
  wired.add(dialog);
  const dismiss = () => (dismissers.get(dialog) ?? closeDialog)(dialog);
  // Escape and platform close requests (for example Android back) behave like Cancel or ×.
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  // A native close that bypassed closeDialog still returns focus and cancels a pending prompt.
  dialog.addEventListener('close', () => { if (!isOpen(dialog) && openers.has(dialog)) { restoreFocus(dialog); dismissers.get(dialog)?.(dialog); } });
}

// Native modal when available; jsdom and older engines fall back to the open attribute.
export function openDialog(dialog) {
  if (!dialog || isOpen(dialog)) return;
  wireDialog(dialog);
  const doc = dialog.ownerDocument;
  openers.set(dialog, doc.activeElement);
  mirrorWarnings(doc);
  if (typeof dialog.showModal === 'function') { try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); } }
  else dialog.setAttribute('open', '');
  if (!dialog.contains(doc.activeElement)) (dialog.querySelector('[autofocus]') ?? dialog.querySelector(FOCUSABLE))?.focus();
}

export function closeDialog(dialog) {
  if (!isOpen(dialog)) return;
  if (typeof dialog.close === 'function') { try { dialog.close(); } catch { dialog.removeAttribute('open'); } }
  if (dialog.hasAttribute('open')) dialog.removeAttribute('open');
  restoreFocus(dialog);
}

// One pending prompt at a time. Continue runs the original action synchronously inside its own
// click so playback keeps the user gesture; Cancel, Escape, × and invalidation run nothing
// destructive. A newer prompt, Stop, terminal error or controller replacement cancels the older one.
export function createConfirm(doc) {
  const $ = id => doc.getElementById(id);
  const dialog = $('confirm-dialog');
  let pending = null;
  function finish(proceed) {
    const current = pending;
    if (!current) return;
    pending = null;
    closeDialog(dialog);
    (proceed ? current.onContinue : current.onCancel)?.();
  }
  if (dialog) {
    wireDialog(dialog);
    dismissers.set(dialog, () => finish(false));
    $('confirm-continue').onclick = () => finish(true);
    $('confirm-cancel').onclick = () => finish(false);
  }
  return {
    ask({ title, text, action = 'Continue' }, onContinue, onCancel) {
      // Without the shell markup there is nobody to ask; keep the original direct behavior.
      if (!dialog) return onContinue();
      finish(false);
      pending = { onContinue, onCancel };
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      $('confirm-continue').textContent = action;
      openDialog(dialog);
    },
    cancel() { finish(false); },
    get pending() { return !!pending; },
  };
}

// The visible entry button and its panel swap places; the panel's Close returns focus to it.
export function setDisclosure(doc, id, open, moveFocus = false) {
  const panel = doc.getElementById(id), toggle = doc.querySelector(`[data-disclose="${id}"]`);
  if (!panel || panel.hidden === !open) return;
  panel.hidden = !open;
  if (toggle) { toggle.hidden = open; toggle.setAttribute('aria-expanded', String(open)); }
  if (moveFocus) (open ? panel.querySelector('[tabindex="-1"], h2') : toggle)?.focus();
}

export function setupShell({ doc, onMenuOpen = () => {} }) {
  const $ = id => doc.getElementById(id);
  const button = $('more'), menu = $('menu');
  const items = () => [...menu.querySelectorAll('[role=menuitem]')].filter(item => !item.hidden && !item.disabled);
  function openMenu(last = false) {
    onMenuOpen();
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    const list = items(); (last ? list.at(-1) : list[0])?.focus();
  }
  function closeMenu(returnFocus) {
    if (menu.hidden) return;
    const inside = menu.contains(doc.activeElement);
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (returnFocus || inside) button.focus();
  }
  button.onclick = () => (menu.hidden ? openMenu() : closeMenu(true));
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault(); openMenu(event.key === 'ArrowUp');
  });
  menu.addEventListener('keydown', event => {
    const list = items(), at = list.indexOf(doc.activeElement);
    const move = index => { event.preventDefault(); list[(index + list.length) % list.length]?.focus(); };
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    else if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Tab') { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  });
  // Item handlers run first (target phase); the menu then closes and opens any tool dialog.
  menu.addEventListener('click', event => {
    const item = event.target.closest('[role=menuitem]');
    if (!item || item.disabled) return;
    closeMenu(false);
    if (item.dataset.dialog) openDialog($(item.dataset.dialog));
  });
  doc.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) closeMenu(false);
    const target = event.target.closest?.('[data-disclose], [data-dismiss], [data-close-dialog]');
    if (!target || target.disabled) return;
    if (target.dataset.disclose) setDisclosure(doc, target.dataset.disclose, true, true);
    else if (target.dataset.dismiss) setDisclosure(doc, target.dataset.dismiss, false, true);
    else closeDialog(target.closest('dialog'));
  });
  for (const dialog of doc.querySelectorAll('dialog')) wireDialog(dialog);
  // Mirrors follow their sources while a modal makes the page behind it inert.
  const Observer = doc.defaultView?.MutationObserver;
  if (Observer) {
    const observer = new Observer(() => mirrorWarnings(doc));
    for (const source of doc.querySelectorAll('[data-warning-source]')) observer.observe(source, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-alert'] });
  }
  mirrorWarnings(doc);
  return { openMenu, closeMenu, openDialog: id => openDialog($(id)), closeDialog: id => closeDialog($(id)) };
}
