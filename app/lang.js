// lang.js: T for app/loc.js. The engine client installs the engine's strings
// (native/i18n.ts); node tools get the English text, the keys.
let t = (key, vars) => (vars ? String(key).replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : String(key));
export function useStrings(translate) { t = translate; }
export const T = (key, vars) => t(String(key), vars);
