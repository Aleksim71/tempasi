/* eslint-env jest, node */
'use strict';

const { assertCanDownload } = require('../src/modules/downloads/downloads.service.cjs');

function makeDbReturning(ok) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: [{ ok }] };
    },
  };
}

describe('downloads.service', () => {
  test('BUY entitlement allows ZIP download', async () => {
    const db = makeDbReturning(true);

    await expect(
      assertCanDownload({
        db,
        userId: 101,
        templateSlug: 'buy-template',
      })
    ).resolves.toBeUndefined();

    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].params).toEqual([101, 'buy-template']);
    expect(db.queries[0].sql).toContain("UPPER(COALESCE(NULLIF(deal_type, ''), 'BUY')) = 'BUY'");
    expect(db.queries[0].sql).toContain("LOWER(COALESCE(kind, '')) <> 'rent'");
  });

  test('RENT-only entitlement does not allow ZIP download', async () => {
    const db = makeDbReturning(false);

    await expect(
      assertCanDownload({
        db,
        userId: 202,
        templateSlug: 'rent-template',
      })
    ).rejects.toMatchObject({
      status: 403,
      code: 'NO_ENTITLEMENT',
    });

    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].params).toEqual([202, 'rent-template']);
  });
});
