from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Firebase Admin SDK — set via env or service account JSON path
    firebase_project_id: str = ""
    firebase_service_account_path: str = ""   # path to serviceAccountKey.json
    firebase_service_account_json: str = ""   # or inline JSON string (Fly.io secret)

    anthropic_api_key: str = ""
    environment: str = "development"
    allowed_origins: str = "http://localhost:3000"

    @property
    def origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
