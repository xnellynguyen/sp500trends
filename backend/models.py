import os
import time
from datetime import datetime, timedelta
import joblib
import pandas as pd
import yfinance as yf
import ta
from google.cloud import storage
from config import GCS_MODEL_BUCKET, redis_client
from data_fetcher import fetch_polygon_aggs


# ─── Static Sector Cache ───
_SECTOR_MAP = {
    "AAPL": "technology", "MSFT": "technology", "NVDA": "technology", "AMD": "technology",
    "QCOM": "technology", "INTC": "technology", "IBM": "technology", "CRM": "technology",
    "AVGO": "technology", "ORCL": "technology", "ADBE": "technology", "CSCO": "technology",
    "ACN": "technology", "TXN": "technology", "NOW": "technology", "INTU": "technology",
    "JPM": "financial_services", "V": "financial_services", "BAC": "financial_services",
    "MA": "financial_services", "WFC": "financial_services", "C": "financial_services",
    "AXP": "financial_services", "GS": "financial_services", "MS": "financial_services",
    "BLK": "financial_services", "SCHW": "financial_services", "BX": "financial_services",
    "JNJ": "healthcare", "UNH": "healthcare", "LLY": "healthcare", "ABBV": "healthcare",
    "PFE": "healthcare", "MRK": "healthcare", "TMO": "healthcare", "ABT": "healthcare",
    "BMY": "healthcare", "AMGN": "healthcare", "MDT": "healthcare", "ISRG": "healthcare",
    "AMZN": "consumer_cyclical", "TSLA": "consumer_cyclical", "HD": "consumer_cyclical",
    "MCD": "consumer_cyclical", "NKE": "consumer_cyclical", "SBUX": "consumer_cyclical",
    "LOW": "consumer_cyclical", "TJX": "consumer_cyclical", "BKNG": "consumer_cyclical",
    "NIO": "consumer_cyclical", "RIVN": "consumer_cyclical", "LCID": "consumer_cyclical",
    "F": "consumer_cyclical", "GM": "consumer_cyclical",
    "META": "communication_services", "GOOGL": "communication_services", "GOOG": "communication_services",
    "NFLX": "communication_services", "DIS": "communication_services", "CMCSA": "communication_services",
    "VZ": "communication_services", "T": "communication_services", "TMUS": "communication_services",
    "SPOT": "communication_services", "SNAP": "communication_services",
    "CAT": "industrials", "GE": "industrials", "BA": "industrials", "HON": "industrials",
    "UNP": "industrials", "UPS": "industrials", "RTX": "industrials", "DE": "industrials",
    "LMT": "industrials", "MMM": "industrials", "FDX": "industrials",
    "WMT": "consumer_defensive", "PG": "consumer_defensive", "KO": "consumer_defensive",
    "PEP": "consumer_defensive", "COST": "consumer_defensive", "PM": "consumer_defensive",
    "MO": "consumer_defensive", "CL": "consumer_defensive", "MDLZ": "consumer_defensive",
    "XOM": "energy", "CVX": "energy", "COP": "energy", "SLB": "energy",
    "EOG": "energy", "MPC": "energy", "PXD": "energy", "PSX": "energy", "VLO": "energy",
    "OXY": "energy", "HAL": "energy",
    "NEE": "utilities", "DUK": "utilities", "SO": "utilities", "SRE": "utilities",
    "AEP": "utilities", "D": "utilities", "EXC": "utilities", "XEL": "utilities",
    "PLD": "real_estate", "AMT": "real_estate", "EQIX": "real_estate",
    "CCI": "real_estate", "PSA": "real_estate", "O": "real_estate", "SPG": "real_estate",
    "LIN": "basic_materials", "SHW": "basic_materials", "NEM": "basic_materials",
    "APD": "basic_materials", "ECL": "basic_materials", "FCX": "basic_materials",
    "CTVA": "basic_materials", "DOW": "basic_materials",
    "SPY": "technology",
    "QQQ": "technology",
}

def get_sector(ticker_symbol):
    """Resolve GICS sector using local cache map or Redis cache."""
    ticker_upper = ticker_symbol.upper()
    
    if redis_client:
        try:
            cached = redis_client.hget("sector_map", ticker_upper)
            if cached: 
                return cached
        except Exception:
            pass
        
    if ticker_upper in _SECTOR_MAP:
        return _SECTOR_MAP[ticker_upper]
        
    _SECTOR_MAP[ticker_upper] = "technology"
    if redis_client:
        try:
            redis_client.hset("sector_map", ticker_upper, "technology")
        except Exception: 
            pass
    return "technology"

# ─── In-Memory Model Cache ───
_MODEL_CACHE = {}

def _load_all_models():
    """Load models from GCS bucket if present, falling back to local files."""
    base_dir = os.path.dirname(__file__)
    sector_dir = os.path.join(base_dir, 'models', 'sector_models')
    
    if GCS_MODEL_BUCKET:
        try:
            print(f"Downloading models from GCS bucket: {GCS_MODEL_BUCKET}")
            storage_client = storage.Client()
            bucket = storage_client.bucket(GCS_MODEL_BUCKET)
            blobs = bucket.list_blobs(prefix="models/")
            for blob in blobs:
                if blob.name.endswith('.joblib'):
                    local_path = os.path.join(base_dir, blob.name)
                    os.makedirs(os.path.dirname(local_path), exist_ok=True)
                    blob.download_to_filename(local_path)
            print("GCS Model download complete.")
        except Exception as e:
            print(f"Failed to download models from GCS: {e}")

    base_path = os.path.join(base_dir, 'models', 'rf_model.joblib')
    if os.path.exists(base_path):
        _MODEL_CACHE['__base__'] = joblib.load(base_path)
    
    if os.path.exists(sector_dir):
        for fname in os.listdir(sector_dir):
            if fname.endswith('.joblib'):
                key = fname.replace('.joblib', '')
                _MODEL_CACHE[key] = joblib.load(os.path.join(sector_dir, fname))
    
    print(f"Loaded {len(_MODEL_CACHE)} models into memory.")

# Load models on module import
_load_all_models()

def get_model(ticker, horizon, use_macro: bool):
    """Retrieve LightGBM model matching sector, horizon, and macro state."""
    sector = get_sector(ticker)
    mac_str = "macro" if use_macro else "nomacro"
    key = f"{sector}_{horizon}_{mac_str}"
    
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]
    fallback_key = f"technology_{horizon}_{mac_str}"
    if fallback_key in _MODEL_CACHE:
        return _MODEL_CACHE[fallback_key]
    return _MODEL_CACHE.get('__base__')

# ─── Macro Data Cache ───
_macro_cache = {"data": None, "timestamp": 0}
_MACRO_TTL = 300

def fetch_global_macro_features():
    """Retrieve SPY returns, SPY SMA_50, and VIX close."""
    if redis_client:
        try:
            cached = redis_client.get("macro_features")
            if cached:
                return pd.read_json(cached)
        except Exception:
            pass

    now = time.time()
    if _macro_cache["data"] is not None and (now - _macro_cache["timestamp"]) < _MACRO_TTL:
        return _macro_cache["data"]
    
    start_date = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    
    spy = fetch_polygon_aggs("SPY", start_date, end_date)
    vix = fetch_polygon_aggs("^VIX", start_date, end_date)
    
    if vix.empty:
        try:
            vix = yf.Ticker("^VIX").history(period="6mo")
            if hasattr(vix.index, 'tz') and vix.index.tz is not None:
                vix.index = vix.index.tz_localize(None)
        except Exception:
            pass
    
    macro_df = pd.DataFrame()
    if not spy.empty and not vix.empty:
        macro_df['SPY_Return'] = spy['Close'].pct_change()
        macro_df['SPY_SMA_50'] = ta.trend.sma_indicator(spy['Close'], window=50)
        macro_df['VIX_Close'] = vix['Close']
        macro_df = macro_df.dropna()

    _macro_cache["data"] = macro_df
    _macro_cache["timestamp"] = now
    
    if redis_client and not macro_df.empty:
        try:
            redis_client.setex("macro_features", _MACRO_TTL, macro_df.to_json())
        except Exception:
            pass
        
    return macro_df
