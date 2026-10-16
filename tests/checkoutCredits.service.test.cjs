// path: tests/checkoutCredits.service.test.cjs
'use strict';

const {
  calculateCheckoutAmounts,
} = require('../src/modules/payments/checkoutCredits.service.cjs');

describe('checkoutCredits.service', () => {
  test('calculateCheckoutAmounts applies partial credit', () => {
    expect(
      calculateCheckoutAmounts({ grossAmountCents: 1000, availableCreditCents: 350 })
    ).toEqual({
      grossAmountCents: 1000,
      creditAppliedCents: 350,
      payableAmountCents: 650,
    });
  });

  test('calculateCheckoutAmounts never applies credit above gross amount', () => {
    expect(
      calculateCheckoutAmounts({ grossAmountCents: 1000, availableCreditCents: 5000 })
    ).toEqual({
      grossAmountCents: 1000,
      creditAppliedCents: 1000,
      payableAmountCents: 0,
    });
  });

  test('calculateCheckoutAmounts handles no credit', () => {
    expect(
      calculateCheckoutAmounts({ grossAmountCents: 1000, availableCreditCents: 0 })
    ).toEqual({
      grossAmountCents: 1000,
      creditAppliedCents: 0,
      payableAmountCents: 1000,
    });
  });
});
