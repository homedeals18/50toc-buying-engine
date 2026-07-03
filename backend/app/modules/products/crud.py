from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.core import Product
from app.modules.products.schemas import ProductCreate, ProductUpdate


def list_products(db: Session, *, upc: str | None = None, store_id: int | None = None, skip: int = 0, limit: int = 100) -> list[Product]:
    stmt = select(Product).offset(skip).limit(limit).order_by(Product.id)
    if upc is not None:
        stmt = stmt.where(Product.upc == upc)
    if store_id is not None:
        stmt = stmt.where(Product.store_id == store_id)
    return list(db.scalars(stmt).all())


def get_product(db: Session, product_id: int) -> Product | None:
    return db.get(Product, product_id)


def create_product(db: Session, payload: ProductCreate) -> Product:
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def update_product(db: Session, product: Product, payload: ProductUpdate) -> Product:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def delete_product(db: Session, product: Product) -> None:
    db.delete(product)
    db.commit()
