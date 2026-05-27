import os
import redis
from dotenv import load_dotenv

load_dotenv()

# Strict security check for SUPABASE_JWT_SECRET
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")
if not SUPABASE_JWT_SECRET:
    raise RuntimeError(
        "CRITICAL ERROR: SUPABASE_JWT_SECRET is missing from the environment variables. "
        "The application cannot start without this key for token authorization. "
        "Please retrieve the JWT Secret from your Supabase Project Settings API tab."
    )

# Supabase Auth Settings
SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("VITE_SUPABASE_URL")
    or "https://jjhbkkwwhnlccdripqoe.supabase.co"
)
SUPABASE_ANON_KEY = (
    os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("VITE_SUPABASE_ANON_KEY")
    or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqaGJra3d3aG5sY2NkcmlwcW9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2ODc3MjksImV4cCI6MjA5NDI2MzcyOX0.0ihU_dRewt9LM7pEm3K0lG822_tHYJeujCsXutDU6pQ"
)
SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN") or "dev_service_token_123"

# Third-Party Keys
POLYGON_API_KEY = os.environ.get("POLYGON_API_KEY")
FMP_API_KEY = os.environ.get("FMP_API_KEY")

# Infra Configurations
GCS_MODEL_BUCKET = os.environ.get("GCS_MODEL_BUCKET")
REDIS_URL = os.environ.get("REDIS_URL", "").strip('"').strip("'")

# CORS Allowed Origins
ALLOWED_ORIGINS = [
    "https://sp500trends.vercel.app",
    "https://sp500-trends.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
]

# Redis Client Initialization
redis_client = None
if REDIS_URL:
    try:
        redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        redis_client.ping()
        print("Connected to Redis successfully.")
    except Exception as e:
        print(f"Redis connection failed: {e}")
