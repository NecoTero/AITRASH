from functools import cached_property

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(
        default="postgresql+psycopg://gantt_app:gantt_app@localhost:5432/gantt_app",
        alias="DATABASE_URL",
    )
    backend_cors_origins: str = Field(
        default="http://localhost:5173",
        alias="BACKEND_CORS_ORIGINS",
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @cached_property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


settings = Settings()

