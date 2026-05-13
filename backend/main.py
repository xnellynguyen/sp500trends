from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import joblib
import os
import ta
import requests
import concurrent.futures

app = FastAPI(title="S&P 500 Trend Predictor API")

# Setup CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define sectors for model routing
SECTORS = {
    "Technology": ["AAPL", "MSFT", "NVDA", "AMD", "QCOM", "INTC", "IBM"],
    "Financial Services": ["JPM", "V", "BAC", "MA", "WFC", "C", "AXP"],
    "Healthcare": ["JNJ", "UNH", "LLY", "ABBV", "PFE", "MRK", "TMO"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW"],
    "Communication Services": ["META", "GOOGL", "NFLX", "DIS", "CMCSA", "VZ", "T"],
    "Industrials": ["CAT", "GE", "BA", "HON", "UNP", "UPS", "RTX"],
    "Consumer Defensive": ["WMT", "PG", "KO", "PEP", "COST", "PM", "MO"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PXD"],
    "Utilities": ["NEE", "DUK", "SO", "SRE", "AEP", "D", "EXC"],
    "Real Estate": ["PLD", "AMT", "EQIX", "CCI", "PSA", "O", "SPG"],
    "Basic Materials": ["LIN", "SHW", "NEM", "APD", "ECL", "FCX", "CTVA"]
}

TICKER_TO_SECTOR = {}
for sec, ticks in SECTORS.items():
    for t in ticks:
        TICKER_TO_SECTOR[t] = sec.replace(" ", "_").lower()

def get_sector(ticker):
    return TICKER_TO_SECTOR.get(ticker, "technology")

def get_model(ticker, horizon, macro):
    sector = get_sector(ticker)
    mac_str = "macro" if macro == "true" else "nomacro"
    path = os.path.join(os.path.dirname(__file__), 'models', 'sector_models', f"{sector}_{horizon}_{mac_str}.joblib")
    if os.path.exists(path):
        return joblib.load(path)
    # Fallback to technology
    path = os.path.join(os.path.dirname(__file__), 'models', 'sector_models', f"technology_{horizon}_{mac_str}.joblib")
    if os.path.exists(path):
        return joblib.load(path)
    # Ultimate fallback to base model
    return joblib.load(os.path.join(os.path.dirname(__file__), 'models', 'rf_model.joblib'))

def fetch_global_macro_features():
    spy = yf.Ticker("SPY").history(period="6mo")
    vix = yf.Ticker("^VIX").history(period="6mo")
    
    if hasattr(spy.index, 'tz_localize'): spy.index = spy.index.tz_localize(None)
    if hasattr(vix.index, 'tz_localize'): vix.index = vix.index.tz_localize(None)
    
    macro_df = pd.DataFrame()
    macro_df['SPY_Return'] = spy['Close'].pct_change()
    macro_df['SPY_SMA_50'] = ta.trend.sma_indicator(spy['Close'], window=50)
    macro_df['VIX_Close'] = vix['Close']
    return macro_df

def get_features_for_ticker(ticker_symbol, use_macro="false", macro_df=None):
    """Fetch recent data and compute features for a single prediction."""
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.history(period="6mo")
    
    if df.empty: return None
    if hasattr(df.index, 'tz_localize'): df.index = df.index.tz_localize(None)
        
    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12)
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close'])
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close'])
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close'])
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close'])
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close'])
    
    if use_macro == "true" and macro_df is not None:
        df = df.join(macro_df, how='left')
    
    df = df.dropna()
    if df.empty: return None
        
    features = [
        'Open', 'High', 'Low', 'Close', 'Volume',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    if use_macro == "true":
        features.extend(['SPY_Return', 'SPY_SMA_50', 'VIX_Close'])
        
    latest_features = df[features].iloc[[-1]]
    latest_close = df['Close'].iloc[-1]
    
    history_df = df.tail(30)
    history = [{"date": str(idx.date()), "price": round(row['Close'], 2)} for idx, row in history_df.iterrows()]
    
    return latest_features, latest_close, history

@app.get("/")
def read_root():
    return {"message": "S&P 500 Trend Predictor API is running."}

@app.get("/api/predict/{ticker}")
def predict_trend(ticker: str, horizon: str = "1d", macro: str = "false"):
    ticker = ticker.upper()
    try:
        model = get_model(ticker, horizon, macro)
    except:
        raise HTTPException(status_code=500, detail="Model not found on server.")
        
    macro_df = fetch_global_macro_features() if macro == "true" else None
    data = get_features_for_ticker(ticker, macro, macro_df)
    
    if data is None:
        raise HTTPException(status_code=404, detail="Could not fetch data or calculate features for ticker.")
        
    latest_features, latest_close, history = data
    
    prediction = model.predict(latest_features)[0]
    probabilities = model.predict_proba(latest_features)[0]
    confidence = probabilities[prediction]
    
    trend = "UP" if prediction == 1 else "DOWN"
    
    return {
        "ticker": ticker,
        "current_price": round(latest_close, 2),
        "predicted_trend": trend,
        "confidence": round(confidence * 100, 2),
        "history": history
    }

class BatchPredictRequest(BaseModel):
    tickers: List[str]
    horizon: str = "1d"
    macro: str = "false"

@app.post("/api/predict_batch")
def predict_batch(req: BatchPredictRequest):
    results = []
    macro_df = fetch_global_macro_features() if req.macro == "true" else None
    
    def process_ticker(t):
        try:
            model = get_model(t, req.horizon, req.macro)
            data = get_features_for_ticker(t, req.macro, macro_df)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                return {
                    "ticker": t,
                    "current_price": round(close_price, 2),
                    "predicted_trend": "UP" if pred == 1 else "DOWN",
                    "confidence": round(conf * 100, 2),
                    "history": history
                }
        except Exception as e:
            print(f"Error predicting {t}: {e}")
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_ticker = {executor.submit(process_ticker, t): t for t in req.tickers}
        for future in concurrent.futures.as_completed(future_to_ticker):
            res = future.result()
            if res:
                results.append(res)
                
    # Maintain original order
    ordered_results = []
    res_dict = {r["ticker"]: r for r in results}
    for t in req.tickers:
        if t in res_dict:
            ordered_results.append(res_dict[t])
            
    return {"results": ordered_results}

@app.get("/api/intraday/{ticker}")
def get_intraday(ticker: str):
    try:
        stock = yf.Ticker(ticker)
        df = stock.history(period="1d", interval="5m")
        if df.empty:
            return {"history": []}
            
        history = []
        # Convert index to localized time if needed, but it's usually timezone-aware
        for idx, row in df.iterrows():
            time_str = idx.strftime("%H:%M")
            history.append({"time": time_str, "price": round(row['Close'], 2)})
            
        return {"ticker": ticker, "history": history}
    except Exception as e:
        print(f"Intraday error for {ticker}: {e}")
        return {"history": []}

@app.get("/api/search")
def search_tickers(q: str):
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            quotes = data.get("quotes", [])
            results = [{"symbol": quote.get("symbol"), "name": quote.get("shortname", quote.get("longname", ""))} 
                       for quote in quotes if quote.get("quoteType") in ["EQUITY", "ETF"]]
            return {"results": results[:5]}
        return {"results": []}
    except Exception as e:
        print(f"Search error: {e}")
        return {"results": []}

@app.get("/api/trending")
def get_trending(horizon: str = "1d", macro: str = "false"):
    trending_symbols = []
    try:
        url = "https://query1.finance.yahoo.com/v1/finance/trending/US?count=30"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            quotes = data.get("finance", {}).get("result", [{}])[0].get("quotes", [])
            for q in quotes:
                sym = q.get("symbol")
                if sym and "-" not in sym and "." not in sym and "^" not in sym:
                    trending_symbols.append(sym)
    except Exception as e:
        print(f"Failed to fetch trending from Yahoo: {e}")
        
    if len(trending_symbols) < 4:
        trending_symbols = ["AAPL", "MSFT", "NVDA", "SPY", "AMZN", "META", "GOOGL", "TSLA", "AMD", "NFLX", "JPM", "V"]
        
    trending_symbols = trending_symbols[:12]
    
    results = []
    
    macro_df = fetch_global_macro_features() if macro == "true" else None
    
    def process_ticker(t):
        try:
            model = get_model(t, horizon, macro)
            data = get_features_for_ticker(t, macro, macro_df)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                return {
                    "ticker": t,
                    "current_price": round(close_price, 2),
                    "predicted_trend": "UP" if pred == 1 else "DOWN",
                    "confidence": round(conf * 100, 2),
                    "history": history
                }
        except Exception as e:
            print(f"Error predicting {t}: {e}")
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_ticker = {executor.submit(process_ticker, t): t for t in trending_symbols}
        for future in concurrent.futures.as_completed(future_to_ticker):
            res = future.result()
            if res:
                results.append(res)
                
    # Sort by probability (confidence) descending
    results.sort(key=lambda x: x["confidence"], reverse=True)
            
    return {"trending": results}
