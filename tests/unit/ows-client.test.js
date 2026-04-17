import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OwsAccount,
  OwsSignRequest,
  OwsSignResponse,
  owsAdapter,
} from '../../src/adapters/ows/client.js';

// --- OwsAccount schema ---

describe('OwsAccount schema', () => {
  const valid = {
    did: 'did:ows:abc123',
    address: '0x' + 'aA'.repeat(20),
    chain: 'xrpl-evm',
    capabilities: ['sign'],
  };

  it('accepts a valid account', () => {
    const result = OwsAccount.parse(valid);
    expect(result).toEqual(valid);
  });

  it('accepts all capability values', () => {
    const result = OwsAccount.parse({ ...valid, capabilities: ['sign', 'pay', 'attest'] });
    expect(result.capabilities).toEqual(['sign', 'pay', 'attest']);
  });

  it('accepts empty capabilities array', () => {
    const result = OwsAccount.parse({ ...valid, capabilities: [] });
    expect(result.capabilities).toEqual([]);
  });

  it('rejects missing did', () => {
    const { did: _did, ...rest } = valid;
    expect(() => OwsAccount.parse(rest)).toThrow();
  });

  it('rejects did shorter than 3 chars', () => {
    expect(() => OwsAccount.parse({ ...valid, did: 'ab' })).toThrow();
  });

  it('accepts did with exactly 3 chars', () => {
    const result = OwsAccount.parse({ ...valid, did: 'abc' });
    expect(result.did).toBe('abc');
  });

  it('rejects missing address', () => {
    const { address: _address, ...rest } = valid;
    expect(() => OwsAccount.parse(rest)).toThrow();
  });

  it('rejects address without 0x prefix', () => {
    expect(() => OwsAccount.parse({ ...valid, address: 'aabbccdd'.repeat(5) })).toThrow();
  });

  it('rejects address with wrong length (too short)', () => {
    expect(() => OwsAccount.parse({ ...valid, address: '0xaabb' })).toThrow();
  });

  it('rejects address with wrong length (too long)', () => {
    expect(() => OwsAccount.parse({ ...valid, address: '0x' + 'ab'.repeat(21) })).toThrow();
  });

  it('rejects address with non-hex characters', () => {
    expect(() => OwsAccount.parse({ ...valid, address: '0x' + 'zz'.repeat(20) })).toThrow();
  });

  it('rejects chain other than xrpl-evm', () => {
    expect(() => OwsAccount.parse({ ...valid, chain: 'ethereum' })).toThrow();
  });

  it('rejects missing chain', () => {
    const { chain: _chain, ...rest } = valid;
    expect(() => OwsAccount.parse(rest)).toThrow();
  });

  it('rejects unknown capability value', () => {
    expect(() => OwsAccount.parse({ ...valid, capabilities: ['fly'] })).toThrow();
  });

  it('rejects missing capabilities', () => {
    const { capabilities: _capabilities, ...rest } = valid;
    expect(() => OwsAccount.parse(rest)).toThrow();
  });

  it('rejects non-string did', () => {
    expect(() => OwsAccount.parse({ ...valid, did: 12345 })).toThrow();
  });

  it('strips unknown properties', () => {
    const result = OwsAccount.parse({ ...valid, extra: 'field' });
    expect(result).not.toHaveProperty('extra');
  });
});

// --- OwsSignRequest schema ---

describe('OwsSignRequest schema', () => {
  const valid = {
    did: 'did:ows:signer1',
    message: 'Please sign this payment',
    purpose: 'x402-payment',
  };

  it('accepts a valid sign request', () => {
    const result = OwsSignRequest.parse(valid);
    expect(result).toEqual(valid);
  });

  it('accepts purpose: login', () => {
    const result = OwsSignRequest.parse({ ...valid, purpose: 'login' });
    expect(result.purpose).toBe('login');
  });

  it('accepts purpose: consent', () => {
    const result = OwsSignRequest.parse({ ...valid, purpose: 'consent' });
    expect(result.purpose).toBe('consent');
  });

  it('rejects invalid purpose', () => {
    expect(() => OwsSignRequest.parse({ ...valid, purpose: 'other' })).toThrow();
  });

  it('rejects missing did', () => {
    const { did: _did, ...rest } = valid;
    expect(() => OwsSignRequest.parse(rest)).toThrow();
  });

  it('rejects missing message', () => {
    const { message: _message, ...rest } = valid;
    expect(() => OwsSignRequest.parse(rest)).toThrow();
  });

  it('rejects missing purpose', () => {
    const { purpose: _purpose, ...rest } = valid;
    expect(() => OwsSignRequest.parse(rest)).toThrow();
  });

  it('accepts empty string did', () => {
    const result = OwsSignRequest.parse({ ...valid, did: '' });
    expect(result.did).toBe('');
  });

  it('accepts empty string message', () => {
    const result = OwsSignRequest.parse({ ...valid, message: '' });
    expect(result.message).toBe('');
  });

  it('rejects non-string message', () => {
    expect(() => OwsSignRequest.parse({ ...valid, message: 42 })).toThrow();
  });
});

// --- OwsSignResponse schema ---

describe('OwsSignResponse schema', () => {
  const valid = {
    signature: '0xdeadbeef',
    did: 'did:ows:signer1',
    signedAt: 1700000000,
  };

  it('accepts a valid sign response', () => {
    const result = OwsSignResponse.parse(valid);
    expect(result).toEqual(valid);
  });

  it('rejects missing signature', () => {
    const { signature: _signature, ...rest } = valid;
    expect(() => OwsSignResponse.parse(rest)).toThrow();
  });

  it('rejects missing did', () => {
    const { did: _did, ...rest } = valid;
    expect(() => OwsSignResponse.parse(rest)).toThrow();
  });

  it('rejects missing signedAt', () => {
    const { signedAt: _signedAt, ...rest } = valid;
    expect(() => OwsSignResponse.parse(rest)).toThrow();
  });

  it('rejects non-number signedAt', () => {
    expect(() => OwsSignResponse.parse({ ...valid, signedAt: '1700000000' })).toThrow();
  });

  it('accepts signedAt of 0', () => {
    const result = OwsSignResponse.parse({ ...valid, signedAt: 0 });
    expect(result.signedAt).toBe(0);
  });

  it('accepts float signedAt', () => {
    const result = OwsSignResponse.parse({ ...valid, signedAt: 1700000000.5 });
    expect(result.signedAt).toBe(1700000000.5);
  });
});

// --- owsAdapter methods ---

describe('owsAdapter', () => {
  it('has name "ows"', () => {
    expect(owsAdapter.name).toBe('ows');
  });

  describe('parseAccount', () => {
    const validAccount = {
      did: 'did:ows:abc',
      address: '0x' + 'ab'.repeat(20),
      chain: 'xrpl-evm',
      capabilities: ['pay'],
    };

    it('returns parsed account on valid input', () => {
      const result = owsAdapter.parseAccount(validAccount);
      expect(result).toEqual(validAccount);
    });

    it('throws ZodError on invalid input', () => {
      expect(() => owsAdapter.parseAccount({})).toThrow();
    });

    it('throws on null input', () => {
      expect(() => owsAdapter.parseAccount(null)).toThrow();
    });

    it('throws on undefined input', () => {
      expect(() => owsAdapter.parseAccount(undefined)).toThrow();
    });
  });

  describe('parseSignRequest', () => {
    const validReq = {
      did: 'did:ows:signer',
      message: 'sign me',
      purpose: 'login',
    };

    it('returns parsed request on valid input', () => {
      const result = owsAdapter.parseSignRequest(validReq);
      expect(result).toEqual(validReq);
    });

    it('throws ZodError on invalid input', () => {
      expect(() => owsAdapter.parseSignRequest({ did: 'x' })).toThrow();
    });

    it('throws on null input', () => {
      expect(() => owsAdapter.parseSignRequest(null)).toThrow();
    });
  });

  describe('buildSignResponse', () => {
    let dateSpy;

    beforeEach(() => {
      dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    });

    afterEach(() => {
      dateSpy.mockRestore();
    });

    it('builds a valid response with correct timestamp', () => {
      const result = owsAdapter.buildSignResponse('0xsig123', 'did:ows:alice');
      expect(result).toEqual({
        signature: '0xsig123',
        did: 'did:ows:alice',
        signedAt: 1700000000,
      });
    });

    it('floors the timestamp to seconds', () => {
      dateSpy.mockReturnValue(1700000000999);
      const result = owsAdapter.buildSignResponse('sig', 'did:x');
      expect(result.signedAt).toBe(1700000000);
    });

    it('throws if signature is not a string', () => {
      expect(() => owsAdapter.buildSignResponse(123, 'did:x')).toThrow();
    });

    it('throws if did is not a string', () => {
      expect(() => owsAdapter.buildSignResponse('sig', 42)).toThrow();
    });

    it('uses current time from Date.now', () => {
      dateSpy.mockReturnValue(1600000000000);
      const result = owsAdapter.buildSignResponse('s', 'd');
      expect(result.signedAt).toBe(1600000000);
    });
  });
});
