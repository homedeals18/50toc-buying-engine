# Architecture

The application is split into backend modules, frontend UI, data access, and external store connectors.

## Backend modules

Each backend domain starts as a package under `backend/app/modules` with its own router. As the system grows, each module can add schemas, services, repositories, and tests without coupling to other domains.

## Data model

SQLAlchemy models live in `backend/app/models`. Alembic owns database schema changes and starts with an initial migration for users, stores, products, UPC mappings, Amazon products, buying rules, buying plans, and purchase history.

## Connectors

Connectors are intentionally separate from store domain logic. Future store integrations should implement the base connector interface and keep scraping/API details isolated from core buying workflows.
