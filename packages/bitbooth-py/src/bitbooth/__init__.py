"""BitBooth Fetch Python client — pay-per-fetch via the x402 protocol."""

from .client import BitBoothClient, CHAINS
from .exceptions import BitBoothError, PaymentError

__version__ = "1.0.0"
__all__ = [
    "BitBoothClient",
    "BitBoothError",
    "PaymentError",
    "CHAINS",
    "__version__",
]
