import { describe, expect, it } from 'vitest';
import { modesOf } from '../src/engine/modes';
import { MESSAGES } from '../src/i18n';

const config = (settings: Record<string, unknown> | null) => ({ identifier: 'x', settings });

describe('banner display and consent modes', () => {
  it('reads settings the way sdk.js does', () => {
    expect(modesOf(config({ displayMode: 'hide', consentMode: 'opt_out' }))).toEqual({ shown: false, optOut: true, displayMode: 'hide', consentMode: 'opt_out' });
    expect(modesOf(config({ displayMode: 'show', consentMode: 'opt_in' }))).toMatchObject({ shown: true, optOut: false });
  });

  it("falls back to the SDK's defaults: shown and opt-in unless set exactly", () => {
    expect(modesOf(config(null))).toEqual({ shown: true, optOut: false, displayMode: null, consentMode: null });
    expect(modesOf(config({ displayMode: 'Hide', consentMode: 'OPT_OUT' }))).toMatchObject({ shown: true, optOut: false });
    expect(modesOf(config({ displayMode: 1, consentMode: true }))).toMatchObject({ shown: true, optOut: false, displayMode: null, consentMode: null });
  });

  it('has the copy in both languages', () => {
    for (const t of [MESSAGES.en.modes, MESSAGES.fr.modes]) {
      for (const text of [t.shownText, t.hiddenText(true), t.hiddenText(false), t.optInText, t.optOutText, t.notSet]) {
        expect(text.length).toBeGreaterThan(20);
        expect(text).not.toMatch(/undefined|\s{2,}/);
      }
      expect(t.field('displayMode', null, 'show')).toContain('"show"');
      expect(t.field('consentMode', 'opt_out', 'opt_in')).toContain('"opt_out"');
    }
  });
});
