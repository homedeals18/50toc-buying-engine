from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class StoreProductSnapshot:
    external_id: str
    name: str
    price: Decimal | None = None
    upc: str | None = None


class StoreConnector(ABC):
    """Base interface for future store integrations."""

    connector_key: str
    display_name: str

    @abstractmethod
    async def search_products(self, query: str) -> list[StoreProductSnapshot]:
        """Search products from an external store catalog."""
