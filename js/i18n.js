// Language for the game code. The choice itself is made by js/lang.js (loaded first, as a classic script);
// this module falls back to the same rule if it is used on its own.
function detect() {
  try { const s = localStorage.getItem('gaze-lang'); if (s === 'ko' || s === 'en') return s; } catch { }
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  return list.some(l => String(l || '').toLowerCase().startsWith('ko')) ? 'ko' : 'en';
}
export const LANG = window.GAZE_LANG === 'ko' || window.GAZE_LANG === 'en' ? window.GAZE_LANG : detect();
export const EN = LANG === 'en';
/** pick the string for the current language: $t('한국어', 'English') */
export const $t = (ko, en) => (EN ? en : ko);
/** switch language (saved, then the page reloads) */
export function setLang(l) {
  if (window.gazeSetLang) { window.gazeSetLang(l); return; }
  try { localStorage.setItem('gaze-lang', l); } catch { }
  if (l !== LANG) location.reload();
}
