from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_name: str = "50TOC Buying Engine"
    api_v1_prefix: str = "/api/v1"
    database_url: str = Field(default="postgresql+psycopg://buying_engine:buying_engine@localhost:5432/buying_engine")
    secret_key: str = Field(default="change-me")
    access_token_expire_minutes: int = 30
    backend_cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
