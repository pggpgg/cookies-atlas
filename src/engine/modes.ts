/**
 * How a banner behaves once the SDK has picked it, from its `settings`, read the way sdk.js
 * reads them:
 *
 *   shown  = "hide" !== settings.displayMode     (anything else, or nothing, opens the banner)
 *   optOut = "opt_out" === settings.consentMode  (anything else, or nothing, is opt-in)
 *
 * With opt-out, the SDK saves an "accept all" choice as soon as the visitor arrives
 * ("consent:autosaved"). With the banner hidden, it returns before opening it; when the
 * banner is also opt-in, it still pushes Google Consent Mode as granted
 * (applyImplicitGrantedConsent), without saving any choice.
 */
import type { AxeptioConfig } from './types';

export interface BannerModes {
  /** The banner opens by itself when a visitor arrives. */
  shown: boolean;
  /** Everything is accepted on arrival, until the visitor refuses. */
  optOut: boolean;
  /** Raw values, null when the setting is absent (the SDK then uses its default). */
  displayMode: string | null;
  consentMode: string | null;
}

export function modesOf(config: AxeptioConfig): BannerModes {
  const settings = config.settings ?? {};
  const displayMode = typeof settings.displayMode === 'string' ? settings.displayMode : null;
  const consentMode = typeof settings.consentMode === 'string' ? settings.consentMode : null;
  return { shown: displayMode !== 'hide', optOut: consentMode === 'opt_out', displayMode, consentMode };
}
