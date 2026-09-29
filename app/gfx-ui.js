/* Summit Pyramid — Graphics section of the Settings panel.
 * Controls carry stable ids and data-gfx attributes; changes apply live and
 * persist in save.settings.gfx (mirrored to the cloud save with the rest). */

import { CATEGORIES, PRESETS, presetTier, choosePreset, resolve } from './gfx.js';
import { gfxStrings } from './gfx-i18n.js';

const $ = id => document.getElementById(id);

// Older saves stored a three-step `tier`; carry an explicit Low/High choice over.
export function migrateGraphics(settings) {
  if (settings.gfx && typeof settings.gfx === 'object') return settings.gfx;
  const legacy = { low: 'low', high: 'high' }[settings.tier];
  settings.gfx = { preset: legacy || 'auto' };
  return settings.gfx;
}

export function initGraphicsPanel({ settings, renderer, persist }) {
  const t = gfxStrings(typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  migrateGraphics(settings);
  const detected = renderer ? renderer.detected : 'low';

  for (const el of document.querySelectorAll('#gfx-section [data-i18n]')) el.textContent = t(el.dataset.i18n);

  // one select per category, "From preset (…)" first
  const host = $('gfx-cats');
  host.innerHTML = '';
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.htmlFor = 'gfx-' + cat;
    label.textContent = t(cat);
    const sel = document.createElement('select');
    sel.id = 'gfx-' + cat;
    sel.dataset.gfx = cat;
    for (const v of ['preset', ...tiers]) {
      const o = document.createElement('option');
      o.value = v;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      if (sel.value === 'preset') delete settings.gfx[cat];
      else settings.gfx[cat] = sel.value;
      apply();
    });
    row.append(label, sel);
    host.appendChild(row);
  }

  const presetSel = $('opt-tier');
  presetSel.addEventListener('change', () => {
    settings.gfx = choosePreset(settings.gfx, presetSel.value);   // a preset clears overrides
    apply();
  });
  const scale = $('gfx-scale');
  scale.addEventListener('input', () => {
    settings.gfx.render_scale = Math.round(+scale.value) / 100;
    apply();
  });
  $('gfx-adaptive').addEventListener('change', e => { settings.gfx.adaptive = e.target.checked; apply(); });
  $('gfx-fps').addEventListener('change', e => { settings.gfx.show_fps = e.target.checked; apply(); });

  function apply() {
    persist();
    if (renderer) renderer.setGraphics(settings.gfx);
    refresh();
  }

  function refreshSummary() {
    const note = $('gfx-post-note');
    if (!renderer) {
      $('gfx-summary').textContent = t('gpuUnknown');
      note.hidden = true;
      return;
    }
    const info = renderer.graphicsInfo(t);
    $('gfx-summary').textContent = (info.gpu || t('gpuUnknown')) + ' · ' + info.summary;
    note.textContent = t('postFailed');
    note.hidden = !info.postFailed;
  }

  function refresh() {
    const g = settings.gfx;
    const r = resolve(g, detected);
    for (const o of presetSel.options) o.textContent = o.value === 'auto' ? t('auto', { tier: t(detected) }) : t(o.value);
    presetSel.value = PRESETS.includes(g.preset) ? g.preset : 'auto';
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      const sel = $('gfx-' + cat);
      for (const o of sel.options) o.textContent = o.value === 'preset' ? t('fromPreset', { tier: t(presetTier(r.preset, cat)) }) : t(o.value);
      sel.value = tiers.includes(g[cat]) ? g[cat] : 'preset';
    }
    scale.value = Math.round(r.renderScale * 100);
    $('gfx-scale-val').textContent = Math.round(r.renderScale * 100) + '%';
    $('gfx-adaptive').checked = r.adaptive;
    $('gfx-fps').checked = r.showFps;
    document.body.dataset.gfxPreset = r.preset;
    document.body.dataset.gfxAuto = r.auto ? 'true' : 'false';
    refreshSummary();
  }

  refresh();
  // keep the cost summary and post-processing note current while the panel is open
  setInterval(() => { if (!$('scr-settings').hidden) refreshSummary(); }, 1000);
  return { refresh };
}
