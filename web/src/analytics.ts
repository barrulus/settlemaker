// Analytics for the /fmg image endpoint.
//
// /fmg is the machine endpoint: the URL contract documents embedding it in an
// <iframe>, so scripts DO run inside embeds and views are countable. That also
// means a plain Umami tag would fire a pageview in three very different
// situations and pile them into one number. So auto-tracking is off and the
// pageview is sent by hand with the path rewritten per context.

const WEBSITE_ID = '162c6727-fc89-4425-9962-7ad4d65e71ba';
const DOMAINS = 'settlemaker.com,www.settlemaker.com,settlemaker.netlify.app';
const SCRIPT = 'https://stats.barrulus.com/script.js';

import { trackEvent, trackPageview } from './umami.js';

export type ViewContext = 'top' | 'embed' | 'preview';

/**
 * Where this page is being viewed from.
 *
 * `preview` is our own builder's iframe, identified by a same-origin referrer.
 * An absent referrer (a strict referrer policy on the embedding page) counts as
 * an external embed — the safer default, since assuming "ours" would silently
 * discard real views.
 */
export function viewContext(): ViewContext {
  if (window.self === window.top) return 'top';
  try {
    if (document.referrer !== '' && new URL(document.referrer).origin === location.origin) {
      return 'preview';
    }
  } catch {
    // Unparseable referrer — treat as external.
  }
  return 'embed';
}

/**
 * Load the tracker and send one pageview, unless this is the builder's own
 * preview: that iframe reloads on every Generate and every dice click, so
 * counting it would bury real traffic under our own UI.
 *
 * Embeds report as /fmg/embed, which separates them from direct visits in the
 * dashboard and keeps Umami's referrer — i.e. which site is embedding us.
 */
export function initAnalytics(context: ViewContext): void {
  if (context === 'preview') return;

  const s = document.createElement('script');
  s.defer = true;
  s.src = SCRIPT;
  s.dataset.websiteId = WEBSITE_ID;
  s.dataset.domains = DOMAINS; // silently drops localhost and deploy previews
  s.dataset.autoTrack = 'false';
  s.addEventListener('load', () => {
    const url = context === 'embed' ? '/fmg/embed' : '/fmg';
    trackPageview(url);
  });
  document.head.appendChild(s);
}

/** Fired at most once per load: did the visitor actually work the map, or just look? */
export function trackInteractionOnce(): () => void {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    trackEvent('fmg-interact');
  };
}
