/**
 * Shared domain shapes (documented via JSDoc; runtime shape comes from Zod).
 *
 * @typedef {`0x${string}`} Address
 * @typedef {`0x${string}`} TxHash
 *
 * @typedef {Object} AgentAccount
 * @property {string} accountId
 * @property {Address} walletAddress
 * @property {string} createdAt
 * @property {string} [owsClientId]
 *
 * @typedef {Object} Payment
 * @property {string} idempotencyKey
 * @property {string} accountId
 * @property {string} amountWei
 * @property {string} assetSymbol
 * @property {TxHash} [txHash]
 * @property {number} [blockNumber]
 * @property {'pending'|'confirmed'|'failed'} status
 * @property {string} createdAt
 * @property {string} [confirmedAt]
 *
 * @typedef {Object} X402AcceptsEntry
 * @property {'exact'} scheme
 * @property {string} network - CAIP-2 network ID (e.g. "eip155:8453", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
 * @property {string} payTo
 * @property {string} asset - symbol@contract (e.g. "USDC@0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
 * @property {string} amount
 *
 * @typedef {Object} X402Challenge
 * @property {string} nonce
 * @property {number} expiresAt
 * @property {string} resource
 * @property {X402AcceptsEntry[]} accepts
 * @property {string} amountWei - legacy
 * @property {string} assetSymbol - legacy
 * @property {Address} payTo - legacy
 * @property {number} chainId - legacy
 *
 * @typedef {Object} ExchangeQuote
 * @property {string} exchange
 * @property {string} fiatCurrency
 * @property {number} fiatAmount
 * @property {string} cryptoAmount
 * @property {string} cryptoAsset
 * @property {number} feeFiat
 * @property {number} expiresAt
 * @property {string} quoteId
 *
 * @typedef {Object} FraudRules
 * @property {string} [maxAmountWei]
 * @property {number} [velocityPerMinute]
 *
 * @typedef {Object} Route
 * @property {string} tenantId
 * @property {string} path
 * @property {string} priceWei
 * @property {'USDC'} asset
 * @property {FraudRules} [fraudRules]
 * @property {number} [cacheTtlSeconds]
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} Tenant
 * @property {string} accountId
 * @property {string} apiKeyHash
 * @property {'free'|'starter'|'growth'|'scale'} plan
 * @property {string} [stripeCustomerId]
 * @property {string} createdAt
 *
 * @typedef {Object} FraudEvent
 * @property {string} accountId
 * @property {string} timestamp
 * @property {'high_velocity'|'repeated_nonce_failure'|'abnormal_amount'} eventType
 * @property {'low'|'medium'|'high'} severity
 * @property {Record<string, unknown>} details
 * @property {number} [ttl]
 *
 * @typedef {Object} RateLimitInfo
 * @property {number} limit
 * @property {number} remaining
 * @property {number} reset
 *
 * @typedef {Object} RateLimitBucket
 * @property {string} accountId
 * @property {number} tokens
 * @property {string} lastRefillAt
 * @property {number} capacity
 * @property {number} refillRate
 *
 * @typedef {Object} WebhookDlqEntry
 * @property {string} eventId
 * @property {string} provider
 * @property {string} payload
 * @property {Record<string, string>} headers
 * @property {string} errorMessage
 * @property {string} errorCode
 * @property {'pending'|'retried'|'resolved'} status
 * @property {number} retryCount
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} [ttl]
 */
export {};
