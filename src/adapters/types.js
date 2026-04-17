/**
 * @typedef {Object} ExchangeAdapter
 * @property {string} name
 * @property {(input: {fiatCurrency: string, fiatAmount: number, cryptoAsset: string}) => Promise<import('../types/domain.js').ExchangeQuote>} quote
 * @property {(input: {quoteId: string, walletAddress: string}) => Promise<{orderId: string}>} executeBuy
 * @property {(rawBody: string, headers: Record<string,string>) => Promise<boolean>} verifyWebhook
 */

/**
 * @typedef {Object} VerifyPaymentInput
 * @property {string} txHash
 * @property {string} expectedTo
 * @property {bigint} expectedAmountWei
 * @property {number} minConfirmations
 */

/**
 * @typedef {Object} VerifyPaymentResult
 * @property {boolean} ok
 * @property {string} [reason]
 * @property {number} [blockNumber]
 */

/**
 * @typedef {Object} ChainAdapter
 * @property {string} name
 * @property {string} caip2 - CAIP-2 network identifier (e.g. "eip155:8453")
 * @property {(input: VerifyPaymentInput) => Promise<VerifyPaymentResult>} verifyPayment
 */
export {};
