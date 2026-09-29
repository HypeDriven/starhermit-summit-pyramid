/* Summit Pyramid — strings for the Graphics settings section.
 * Locale comes from navigator.language (the game has no language setting). */

const EN = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', medium: 'Medium',
  renderScale: 'Render scale', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  fromPreset: 'From preset ({tier})', postFailed: 'Post-processing is unavailable on this device — rendering without effects.',
  shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade', antialias: 'Anti-aliasing',
  reflections: 'Reflections', particles: 'Particles', background: 'Sky animation', detail: 'Detail',
  off: 'Off', on: 'On', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Static', animated: 'Animated',
  plain: 'Plain', detailed: 'Detailed',
  noShadows: 'no shadows', shadowsN: '{n}² shadows', aoOn: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloomOn: 'bloom', reflectionsOn: 'reflections', noAA: 'no anti-aliasing', gpuUnknown: 'unknown GPU',
};

const STR = {
  'en-US': Object.assign({}, EN, { grade: 'Color grade' }),
  'en-GB': EN,
  'es-419': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    renderScale: 'Escala de renderizado', adaptive: 'Resolución adaptable', showFps: 'Mostrar fotogramas por segundo',
    fromPreset: 'Según el ajuste ({tier})', postFailed: 'El posprocesado no está disponible en este dispositivo; se renderiza sin efectos.',
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing',
    reflections: 'Reflejos', particles: 'Partículas', background: 'Animación del cielo', detail: 'Detalle',
    off: 'No', on: 'Sí', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Estático', animated: 'Animado',
    plain: 'Simple', detailed: 'Detallado',
    noShadows: 'sin sombras', shadowsN: 'sombras {n}²', aoOn: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
    bloomOn: 'resplandor', reflectionsOn: 'reflejos', noAA: 'sin antialiasing', gpuUnknown: 'GPU desconocida',
  },
  'es-ES': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    renderScale: 'Escala de renderizado', adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    fromPreset: 'Del preajuste ({tier})', postFailed: 'El posprocesado no está disponible en este dispositivo; se renderiza sin efectos.',
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Gradación de color', antialias: 'Suavizado de bordes',
    reflections: 'Reflejos', particles: 'Partículas', background: 'Animación del cielo', detail: 'Detalle',
    off: 'Desactivado', on: 'Activado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Estático', animated: 'Animado',
    plain: 'Sencillo', detailed: 'Detallado',
    noShadows: 'sin sombras', shadowsN: 'sombras {n}²', aoOn: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
    bloomOn: 'resplandor', reflectionsOn: 'reflejos', noAA: 'sin suavizado', gpuUnknown: 'GPU desconocida',
  },
  'de-DE': {
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', medium: 'Mittel',
    renderScale: 'Renderskalierung', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    fromPreset: 'Aus Voreinstellung ({tier})', postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar – Darstellung ohne Effekte.',
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur', antialias: 'Kantenglättung',
    reflections: 'Reflexionen', particles: 'Partikel', background: 'Himmelsanimation', detail: 'Details',
    off: 'Aus', on: 'An', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Statisch', animated: 'Animiert',
    plain: 'Einfach', detailed: 'Detailliert',
    noShadows: 'keine Schatten', shadowsN: '{n}²-Schatten', aoOn: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
    bloomOn: 'Leuchteffekt', reflectionsOn: 'Reflexionen', noAA: 'keine Kantenglättung', gpuUnknown: 'unbekannte GPU',
  },
  'fr-FR': {
    graphics: 'Graphismes', quality: 'Qualité', auto: 'Automatique (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', medium: 'Moyenne',
    renderScale: 'Échelle de rendu', adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    fromPreset: 'Selon le préréglage ({tier})', postFailed: 'Le post-traitement est indisponible sur cet appareil ; rendu sans effets.',
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage',
    reflections: 'Reflets', particles: 'Particules', background: 'Animation du ciel', detail: 'Détails',
    off: 'Désactivé', on: 'Activé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Statique', animated: 'Animé',
    plain: 'Simple', detailed: 'Détaillé',
    noShadows: 'sans ombres', shadowsN: 'ombres {n}²', aoOn: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
    bloomOn: 'halo', reflectionsOn: 'reflets', noAA: 'sans anticrénelage', gpuUnknown: 'GPU inconnu',
  },
  'fr-CA': {
    graphics: 'Graphiques', quality: 'Qualité', auto: 'Automatique (détectée : {tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', medium: 'Moyenne',
    renderScale: 'Échelle de rendu', adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    fromPreset: 'Selon le préréglage ({tier})', postFailed: 'Le post-traitement n’est pas offert sur cet appareil; rendu sans effets.',
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Correction des couleurs', antialias: 'Anticrénelage',
    reflections: 'Reflets', particles: 'Particules', background: 'Animation du ciel', detail: 'Détails',
    off: 'Désactivé', on: 'Activé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Statique', animated: 'Animé',
    plain: 'Simple', detailed: 'Détaillé',
    noShadows: 'sans ombres', shadowsN: 'ombres {n}²', aoOn: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
    bloomOn: 'halo', reflectionsOn: 'reflets', noAA: 'sans anticrénelage', gpuUnknown: 'GPU inconnu',
  },
  'pt-BR': {
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Média',
    renderScale: 'Escala de renderização', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    fromPreset: 'Da predefinição ({tier})', postFailed: 'O pós-processamento não está disponível neste dispositivo; renderizando sem efeitos.',
    shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhamento',
    reflections: 'Reflexos', particles: 'Partículas', background: 'Animação do céu', detail: 'Detalhe',
    off: 'Desligado', on: 'Ligado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Estático', animated: 'Animado',
    plain: 'Simples', detailed: 'Detalhado',
    noShadows: 'sem sombras', shadowsN: 'sombras {n}²', aoOn: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa',
    bloomOn: 'brilho', reflectionsOn: 'reflexos', noAA: 'sem antisserrilhamento', gpuUnknown: 'GPU desconhecida',
  },
  'it-IT': {
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    renderScale: 'Scala di rendering', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frame rate',
    fromPreset: 'Dal preset ({tier})', postFailed: 'La post-elaborazione non è disponibile su questo dispositivo: rendering senza effetti.',
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing',
    reflections: 'Riflessi', particles: 'Particelle', background: 'Animazione del cielo', detail: 'Dettaglio',
    off: 'No', on: 'Sì', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Statico', animated: 'Animato',
    plain: 'Semplice', detailed: 'Dettagliato',
    noShadows: 'nessuna ombra', shadowsN: 'ombre {n}²', aoOn: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
    bloomOn: 'bagliore', reflectionsOn: 'riflessi', noAA: 'nessun antialiasing', gpuUnknown: 'GPU sconosciuta',
  },
};

export const GFX_LOCALES = Object.keys(STR);

/** Map a BCP-47 tag onto a supported locale (language fallback, then en-US). */
export function pickLocale(tag) {
  const t = String(tag || 'en-US');
  if (STR[t]) return t;
  const lang = t.split('-')[0].toLowerCase();
  const region = (t.split('-')[1] || '').toUpperCase();
  if (lang === 'en') return region === 'US' || !region ? 'en-US' : 'en-GB';
  if (lang === 'es') return region === 'ES' ? 'es-ES' : 'es-419';
  if (lang === 'fr') return region === 'CA' ? 'fr-CA' : 'fr-FR';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'it') return 'it-IT';
  return 'en-US';
}

export function gfxStrings(tag) {
  const table = STR[pickLocale(tag)];
  return (key, vars) => {
    let s = table[key] != null ? table[key] : (EN[key] != null ? EN[key] : key);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
    return s;
  };
}
