import { describe, it, expect } from 'vitest';
import {
  Caip2Network,
  parseCaip2,
  isXrplNetwork,
  isEvmNetwork,
  isSolanaNetwork,
} from '../../src/validators/caip2.js';

describe('caip2', () => {
  describe('Caip2Network Zod schema', () => {
    it('accepts eip155:8453', () => {
      expect(Caip2Network.parse('eip155:8453')).toBe('eip155:8453');
    });

    it('accepts eip155:1440002', () => {
      expect(Caip2Network.parse('eip155:1440002')).toBe('eip155:1440002');
    });

    it('accepts xrpl:0', () => {
      expect(Caip2Network.parse('xrpl:0')).toBe('xrpl:0');
    });

    it('accepts xrpl:1', () => {
      expect(Caip2Network.parse('xrpl:1')).toBe('xrpl:1');
    });

    it('accepts solana network', () => {
      expect(Caip2Network.parse('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      );
    });

    it('rejects empty string', () => {
      expect(() => Caip2Network.parse('')).toThrow();
    });

    it('rejects missing reference', () => {
      expect(() => Caip2Network.parse('eip155:')).toThrow();
    });

    it('rejects missing namespace', () => {
      expect(() => Caip2Network.parse(':8453')).toThrow();
    });

    it('rejects uppercase namespace', () => {
      expect(() => Caip2Network.parse('EIP155:8453')).toThrow();
    });

    it('rejects no colon separator', () => {
      expect(() => Caip2Network.parse('eip155-8453')).toThrow();
    });
  });

  describe('parseCaip2', () => {
    it('parses eip155:8453 into namespace and reference', () => {
      expect(parseCaip2('eip155:8453')).toEqual({ namespace: 'eip155', reference: '8453' });
    });

    it('parses xrpl:0', () => {
      expect(parseCaip2('xrpl:0')).toEqual({ namespace: 'xrpl', reference: '0' });
    });

    it('parses xrpl:1', () => {
      expect(parseCaip2('xrpl:1')).toEqual({ namespace: 'xrpl', reference: '1' });
    });

    it('parses solana network', () => {
      const result = parseCaip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      expect(result).toEqual({
        namespace: 'solana',
        reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      });
    });

    it('returns null for string without colon', () => {
      expect(parseCaip2('eip155')).toBeNull();
    });

    it('returns null for empty namespace (leading colon)', () => {
      expect(parseCaip2(':8453')).toBeNull();
    });

    it('returns null for empty reference (trailing colon)', () => {
      expect(parseCaip2('eip155:')).toBeNull();
    });

    it('handles multiple colons by splitting on first', () => {
      const result = parseCaip2('cosmos:cosmoshub-4');
      expect(result).toEqual({ namespace: 'cosmos', reference: 'cosmoshub-4' });
    });
  });

  describe('isXrplNetwork', () => {
    it('returns true for xrpl:0', () => {
      expect(isXrplNetwork('xrpl:0')).toBe(true);
    });

    it('returns true for xrpl:1', () => {
      expect(isXrplNetwork('xrpl:1')).toBe(true);
    });

    it('returns false for eip155:8453', () => {
      expect(isXrplNetwork('eip155:8453')).toBe(false);
    });

    it('returns false for invalid string', () => {
      expect(isXrplNetwork('nocolon')).toBe(false);
    });
  });

  describe('isEvmNetwork', () => {
    it('returns true for eip155:8453', () => {
      expect(isEvmNetwork('eip155:8453')).toBe(true);
    });

    it('returns true for eip155:1440002', () => {
      expect(isEvmNetwork('eip155:1440002')).toBe(true);
    });

    it('returns false for xrpl:0', () => {
      expect(isEvmNetwork('xrpl:0')).toBe(false);
    });

    it('returns false for invalid string', () => {
      expect(isEvmNetwork('')).toBe(false);
    });
  });

  describe('isSolanaNetwork', () => {
    it('returns true for solana namespace', () => {
      expect(isSolanaNetwork('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(true);
    });

    it('returns false for eip155 namespace', () => {
      expect(isSolanaNetwork('eip155:8453')).toBe(false);
    });

    it('returns false for xrpl namespace', () => {
      expect(isSolanaNetwork('xrpl:0')).toBe(false);
    });
  });
});
