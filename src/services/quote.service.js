import { bestQuote, getAdapter } from './routing.service.js';

export const quoteService = {
  async getBest(input) {
    if (input.exchange) {
      return getAdapter(input.exchange).quote({
        fiatCurrency: input.fiatCurrency,
        fiatAmount: input.fiatAmount,
        cryptoAsset: input.cryptoAsset,
      });
    }
    return bestQuote({
      fiatCurrency: input.fiatCurrency,
      fiatAmount: input.fiatAmount,
      cryptoAsset: input.cryptoAsset,
    });
  },
};
