"""Exception types raised by the bitbooth client."""


class BitBoothError(Exception):
    """Base exception raised by the BitBooth client."""


class PaymentError(BitBoothError):
    """Raised when an x402 payment attempt fails (on-chain or verification)."""
