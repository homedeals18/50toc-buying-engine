from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.products import crud
from app.modules.products.schemas import ProductCreate, ProductRead, ProductUpdate

router = APIRouter(prefix="/products", tags=["Products"])


@router.get("/health", summary="Check product catalog module health")
def products_health() -> dict[str, str]:
    return {"module": "products", "status": "ready"}


@router.get("", response_model=list[ProductRead], summary="List product catalog entries")
def list_products(
    upc: str | None = Query(default=None, description="Filter to all store listings for a shared UPC."),
    store_id: int | None = Query(default=None, description="Filter products to one store."),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[ProductRead]:
    return crud.list_products(db, upc=upc, store_id=store_id, skip=skip, limit=limit)


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED, summary="Create a product catalog entry")
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> ProductRead:
    return crud.create_product(db, payload)


@router.get("/{product_id}", response_model=ProductRead, summary="Get a product catalog entry")
def get_product(product_id: int, db: Session = Depends(get_db)) -> ProductRead:
    product = crud.get_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


@router.patch("/{product_id}", response_model=ProductRead, summary="Update a product catalog entry")
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)) -> ProductRead:
    product = crud.get_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return crud.update_product(db, product, payload)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a product catalog entry")
def delete_product(product_id: int, db: Session = Depends(get_db)) -> Response:
    product = crud.get_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    crud.delete_product(db, product)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
