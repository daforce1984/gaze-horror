/* Language boot (classic script, runs before first paint so the title screen never flashes the other language).
   Choice: ?lang=ko|en in the URL > the choice saved in localStorage > the browser's languages (any 'ko*' -> Korean, else English).
   Static HTML text is translated from data-en (innerHTML) / data-en-aria (aria-label) / data-en-content (meta) attributes. */
(function () {
  var KEY = 'gaze-lang';
  function norm(v) { return v === 'ko' || v === 'en' ? v : null; }
  var lang = null;
  try { lang = norm(new URLSearchParams(location.search).get('lang')); if (lang) localStorage.setItem(KEY, lang); } catch (e) { }
  if (!lang) { try { lang = norm(localStorage.getItem(KEY)); } catch (e) { } }
  if (!lang) {
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || navigator.userLanguage || ''];
    lang = 'en';
    for (var i = 0; i < list.length; i++) if (String(list[i] || '').toLowerCase().indexOf('ko') === 0) { lang = 'ko'; break; }
  }
  window.GAZE_LANG = lang;
  document.documentElement.lang = lang;

  // switch: remember and reload (every string, canvas and memo is rebuilt in the new language)
  window.gazeSetLang = function (l) {
    l = norm(l); if (!l) return;
    try { localStorage.setItem(KEY, l); } catch (e) { }
    if (l === window.GAZE_LANG) return;
    try {   // drop a ?lang= in the address so it does not override the new choice
      var u = new URL(location.href);
      if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); location.replace(u.toString()); return; }
    } catch (e) { }
    location.reload();
  };

  function apply() {
    if (lang === 'en') {
      var n = document.querySelectorAll('[data-en]');
      for (var i = 0; i < n.length; i++) n[i].innerHTML = n[i].getAttribute('data-en');
      n = document.querySelectorAll('[data-en-aria]');
      for (i = 0; i < n.length; i++) n[i].setAttribute('aria-label', n[i].getAttribute('data-en-aria'));
      n = document.querySelectorAll('[data-en-content]');
      for (i = 0; i < n.length; i++) n[i].setAttribute('content', n[i].getAttribute('data-en-content'));
      var t = document.querySelector('title[data-en-title]'); if (t) document.title = t.getAttribute('data-en-title');
    }
    var b = document.querySelectorAll('[data-lang]');
    for (var j = 0; j < b.length; j++) {
      b[j].classList.toggle('on', b[j].getAttribute('data-lang') === lang);
      b[j].addEventListener('click', function (e) { window.gazeSetLang(e.currentTarget.getAttribute('data-lang')); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
