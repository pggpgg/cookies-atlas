import { describe, expect, it } from 'vitest';
import { REGION_TABLE, REGULATIONS } from '../src/engine/regions';
import snapshot from '../sdk-snapshot/snapshot.json';

describe('region table stays in sync with the SDK snapshot', () => {
  it('has the same regulation enum as sdk.js', () => {
    expect(REGULATIONS).toEqual(snapshot.regulations);
  });

  it('has the same countries and subdivisions as sdk.js', () => {
    expect(REGION_TABLE).toEqual(snapshot.regionTable);
  });

  it('the snapshot was captured without extraction problems', () => {
    expect(snapshot.problems).toEqual([]);
  });
});
