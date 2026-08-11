// Shared Umami typing and guarded helpers, so the three pages that report
// don't each re-declare the global with a slightly different shape.
//
// Every call is optional-chained. The tracker is genuinely absent in normal
// operation: data-domains suppresses it on localhost and deploy previews, and
// blockers remove it outright. Nothing here may ever be load-bearing.

declare global {
  interface Window {
    umami?: {
      track: {
        (name: string, data?: Record<string, string | number | boolean>): void;
        (build: (props: Record<string, unknown>) => Record<string, unknown>): void;
      };
    };
  }
}

/** Named custom event. */
export function trackEvent(name: string, data?: Record<string, string | number | boolean>): void {
  window.umami?.track(name, data);
}

/** Pageview with the reported path overridden — used to separate embeds from direct visits. */
export function trackPageview(url: string): void {
  window.umami?.track((props) => ({ ...props, url }));
}
