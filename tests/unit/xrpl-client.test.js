import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockConnect = vi.hoisted(() => vi.fn());
const mockRequest = vi.hoisted(() => vi.fn());
const mockDisconnect = vi.hoisted(() => vi.fn());
const mockIsConnected = vi.hoisted(() => vi.fn(() => false));
const MockClient = vi.hoisted(() =>
  vi.fn(function () {
    this.connect = mockConnect;
    this.request = mockRequest;
    this.disconnect = mockDisconnect;
    this.isConnected = mockIsConnected;
  }),
);

vi.mock('xrpl', () => ({ Client: MockClient }));

const DEST = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const SENDER = 'rN7n3473SaZBCG4dFL83w7p1W6G3nUqUKr';
const TX_HASH = 'A' + '0'.repeat(63);
const ISSUER = 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B';

function makeXrpTx({
  destination = DEST,
  amount = '1000000',
  result = 'tesSUCCESS',
  validated = true,
  type = 'Payment',
  ledger = 83145921,
  delivered = null,
} = {}) {
  return {
    TransactionType: type,
    Account: SENDER,
    Destination: destination,
    Amount: amount,
    validated,
    meta: {
      TransactionResult: result,
      delivered_amount: delivered ?? amount,
    },
    ledger_index: ledger,
  };
}

function makeIouTx({
  destination = DEST,
  currency = 'USD',
  issuer = ISSUER,
  value = '0.005',
  result = 'tesSUCCESS',
  validated = true,
  ledger = 83145922,
} = {}) {
  const iou = { currency, issuer, value };
  return {
    TransactionType: 'Payment',
    Account: SENDER,
    Destination: destination,
    Amount: iou,
    validated,
    meta: {
      TransactionResult: result,
      delivered_amount: iou,
    },
    ledger_index: ledger,
  };
}

async function freshImport() {
  vi.resetModules();
  MockClient.mockClear();
  mockIsConnected.mockReturnValue(false);
  mockConnect.mockResolvedValue(undefined);
  vi.doMock('xrpl', () => ({ Client: MockClient }));
  return import('../../src/adapters/xrpl/client.js');
}

describe('xrpl/client', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.XRPL_WS_URL;
    delete process.env.STAGE;
    delete process.env.ADAPTER_HTTP_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('constants', () => {
    it('exports MAINNET_WS and TESTNET_WS URLs', async () => {
      const mod = await freshImport();
      expect(mod.MAINNET_WS).toBe('wss://xrplcluster.com');
      expect(mod.TESTNET_WS).toBe('wss://s.altnet.rippletest.net:51233');
    });
  });

  describe('getWsUrl', () => {
    it('returns XRPL_WS_URL env var when set', async () => {
      process.env.XRPL_WS_URL = 'wss://custom.example.com';
      const { getWsUrl } = await freshImport();
      expect(getWsUrl()).toBe('wss://custom.example.com');
    });

    it('returns mainnet URL when STAGE=prod', async () => {
      process.env.STAGE = 'prod';
      const { getWsUrl } = await freshImport();
      expect(getWsUrl()).toBe('wss://xrplcluster.com');
    });

    it('returns testnet URL when STAGE=staging', async () => {
      process.env.STAGE = 'staging';
      const { getWsUrl } = await freshImport();
      expect(getWsUrl()).toBe('wss://s.altnet.rippletest.net:51233');
    });

    it('returns testnet URL when STAGE is unset (default dev)', async () => {
      const { getWsUrl } = await freshImport();
      expect(getWsUrl()).toBe('wss://s.altnet.rippletest.net:51233');
    });
  });

  describe('getClient', () => {
    it('creates client and connects', async () => {
      const { getClient } = await freshImport();
      await getClient();
      expect(MockClient).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('returns cached client when still connected', async () => {
      const { getClient } = await freshImport();
      await getClient();
      mockIsConnected.mockReturnValue(true);
      await getClient();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('reconnects when client disconnected', async () => {
      const { getClient } = await freshImport();
      await getClient();
      mockIsConnected.mockReturnValue(false);
      await getClient();
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('uses ADAPTER_HTTP_TIMEOUT_MS for connection timeout', async () => {
      process.env.ADAPTER_HTTP_TIMEOUT_MS = '15000';
      const { getClient } = await freshImport();
      await getClient();
      expect(MockClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ connectionTimeout: 15000 }),
      );
    });
  });

  describe('getTransaction', () => {
    it('returns tx result on success', async () => {
      const tx = makeXrpTx();
      mockRequest.mockResolvedValue({ result: tx });
      const { getTransaction } = await freshImport();

      const result = await getTransaction(TX_HASH);
      expect(result).toEqual(tx);
    });

    it('sends correct command to XRPL node', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { getTransaction } = await freshImport();

      await getTransaction(TX_HASH);
      expect(mockRequest).toHaveBeenCalledWith({
        command: 'tx',
        transaction: TX_HASH,
      });
    });

    it('throws UpstreamError when result is null', async () => {
      mockRequest.mockResolvedValue(null);
      const { getTransaction } = await freshImport();

      await expect(getTransaction(TX_HASH)).rejects.toThrow('Upstream native-xrpl failed');
    });

    it('throws UpstreamError when result field is missing', async () => {
      mockRequest.mockResolvedValue({});
      const { getTransaction } = await freshImport();

      await expect(getTransaction(TX_HASH)).rejects.toThrow('Upstream native-xrpl failed');
    });

    it('propagates connection errors', async () => {
      mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
      const { getTransaction } = await freshImport();

      await expect(getTransaction(TX_HASH)).rejects.toThrow();
    });
  });

  describe('verifyPayment — XRP (drops)', () => {
    const xrpInput = {
      txHash: TX_HASH,
      destination: DEST,
      amount: '1000000',
    };

    it('returns ok:true for valid XRP payment', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(xrpInput);
      expect(result).toEqual({ ok: true, ledgerIndex: 83145921 });
    });

    it('accepts overpayment (delivered > expected)', async () => {
      const tx = makeXrpTx({ amount: '2000000', delivered: '2000000' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(xrpInput);
      expect(result.ok).toBe(true);
    });

    it('accepts exact amount', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(xrpInput);
      expect(result.ok).toBe(true);
    });

    it('rejects underpayment', async () => {
      const tx = makeXrpTx({ amount: '500000', delivered: '500000' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(xrpInput);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });
  });

  describe('verifyPayment — IOU', () => {
    const iouInput = {
      txHash: TX_HASH,
      destination: DEST,
      amount: { currency: 'USD', issuer: ISSUER, value: '0.005' },
    };

    it('returns ok:true for valid IOU payment', async () => {
      mockRequest.mockResolvedValue({ result: makeIouTx() });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(iouInput);
      expect(result).toEqual({ ok: true, ledgerIndex: 83145922 });
    });

    it('accepts overpayment for IOU', async () => {
      const tx = makeIouTx({ value: '1.00' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(iouInput);
      expect(result.ok).toBe(true);
    });

    it('rejects IOU with wrong currency', async () => {
      const tx = makeIouTx({ currency: 'EUR' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(iouInput);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects IOU with wrong issuer', async () => {
      const tx = makeIouTx({ issuer: 'rPVMhWBsfF9iMXYj3aAzJVkqHDhV3LGZWB' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(iouInput);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects IOU with insufficient value', async () => {
      const tx = makeIouTx({ value: '0.001' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(iouInput);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('uses explicit issuer param over amount.issuer', async () => {
      const overrideIssuer = 'rPVMhWBsfF9iMXYj3aAzJVkqHDhV3LGZWB';
      const tx = makeIouTx({ issuer: overrideIssuer });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...iouInput,
        issuer: overrideIssuer,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('verifyPayment — rejection paths', () => {
    const baseInput = {
      txHash: TX_HASH,
      destination: DEST,
      amount: '1000000',
    };

    it('rejects non-Payment transaction type', async () => {
      const tx = makeXrpTx({ type: 'OfferCreate' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'not-a-payment' });
    });

    it('rejects unvalidated transaction', async () => {
      const tx = makeXrpTx({ validated: false });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'not-validated' });
    });

    it('rejects failed transaction (not tesSUCCESS)', async () => {
      const tx = makeXrpTx({ result: 'tecPATH_PARTIAL' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'tx-failed' });
    });

    it('rejects wrong destination', async () => {
      const tx = makeXrpTx({ destination: 'rPVMhWBsfF9iMXYj3aAzJVkqHDhV3LGZWB' });
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'wrong-destination' });
    });

    it('rejects when delivered_amount is missing', async () => {
      const tx = makeXrpTx();
      tx.meta.delivered_amount = undefined;
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'no-delivered-amount' });
    });

    it('rejects type mismatch: drops expected, IOU delivered', async () => {
      const tx = makeXrpTx();
      tx.meta.delivered_amount = { currency: 'USD', issuer: ISSUER, value: '1.00' };
      mockRequest.mockResolvedValue({ result: tx });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects type mismatch: IOU expected, drops delivered', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment({
        ...baseInput,
        amount: { currency: 'USD', issuer: ISSUER, value: '0.005' },
      });
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('returns invalid-tx-shape for malformed tx response', async () => {
      mockRequest.mockResolvedValue({ result: { bad: 'shape' } });
      const { verifyPayment } = await freshImport();

      const result = await verifyPayment(baseInput);
      expect(result).toEqual({ ok: false, reason: 'invalid-tx-shape' });
    });
  });

  describe('verifyPayment — allowed[] multi-issuer', () => {
    const USDC_ISSUER = 'rcEGREd8NmkKRE8GE424sksyt1tJVFZwu';
    const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
    const STRANGER_ISSUER = 'rPVMhWBsfF9iMXYj3aAzJVkqHDhV3LGZWB';

    const allowed = [
      { currency: 'USD', issuer: USDC_ISSUER, value: '0.005' },
      { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '0.005' },
    ];

    it('accepts payment delivered in USDC', async () => {
      mockRequest.mockResolvedValue({
        result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '0.005' }),
      });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({ txHash: TX_HASH, destination: DEST, allowed });
      expect(result.ok).toBe(true);
    });

    it('accepts payment delivered in RLUSD', async () => {
      mockRequest.mockResolvedValue({
        result: makeIouTx({ currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '0.005' }),
      });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({ txHash: TX_HASH, destination: DEST, allowed });
      expect(result.ok).toBe(true);
    });

    it('rejects unknown issuer even when currency matches', async () => {
      mockRequest.mockResolvedValue({
        result: makeIouTx({ currency: 'USD', issuer: STRANGER_ISSUER, value: '0.005' }),
      });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({ txHash: TX_HASH, destination: DEST, allowed });
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects RLUSD forged with Circle USDC issuer', async () => {
      mockRequest.mockResolvedValue({
        result: makeIouTx({ currency: 'RLUSD', issuer: USDC_ISSUER, value: '0.005' }),
      });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({ txHash: TX_HASH, destination: DEST, allowed });
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('rejects USDC under the required amount', async () => {
      mockRequest.mockResolvedValue({
        result: makeIouTx({ currency: 'USD', issuer: USDC_ISSUER, value: '0.001' }),
      });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({ txHash: TX_HASH, destination: DEST, allowed });
      expect(result).toEqual({ ok: false, reason: 'amount-mismatch' });
    });

    it('accepts overpayment in either allowed stablecoin', async () => {
      mockRequest.mockResolvedValue({
        result: makeIouTx({ currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '10.0' }),
      });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({ txHash: TX_HASH, destination: DEST, allowed });
      expect(result.ok).toBe(true);
    });

    it('empty allowed array falls through to single-amount matching', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { verifyPayment } = await freshImport();
      const result = await verifyPayment({
        txHash: TX_HASH,
        destination: DEST,
        amount: '1000000',
        allowed: [],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('_resetClient', () => {
    it('disconnects and clears cached client', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { getTransaction, _resetClient } = await freshImport();

      await getTransaction(TX_HASH);
      mockIsConnected.mockReturnValue(true);
      _resetClient();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('does not throw when no client exists', async () => {
      const { _resetClient } = await freshImport();
      expect(() => _resetClient()).not.toThrow();
    });

    it('does not call disconnect when client is already disconnected', async () => {
      mockRequest.mockResolvedValue({ result: makeXrpTx() });
      const { getTransaction, _resetClient } = await freshImport();

      await getTransaction(TX_HASH);
      mockIsConnected.mockReturnValue(false);
      _resetClient();

      expect(mockDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('_resetBreaker', () => {
    it('resets circuit breaker without throwing', async () => {
      const { _resetBreaker } = await freshImport();
      expect(() => _resetBreaker()).not.toThrow();
    });
  });
});
