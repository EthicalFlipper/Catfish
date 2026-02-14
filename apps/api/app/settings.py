"""
Application settings loaded from environment variables
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration"""
    
    # API Settings
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    debug: bool = False
    
    # OpenAI (for future use)
    openai_api_key: str = ""
    
    # Future: Whisper settings
    whisper_model: str = "whisper-1"
    
    # Future: GPT settings
    gpt_model: str = "gpt-4o-mini"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
