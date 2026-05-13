from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import joblib
import os
import ta
import requests

app = FastAPI(title="S&P 500 Trend Predictor API")

# Setup CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the model
model_path = os.path.join(os.path.dirname(__file__), 'models', 'rf_model.joblib')
if os.path.exists(model_path):
    model = joblib.load(model_path)
else:
    model = None
    print("Warning: Model not found. Please run ml_model.py first.")

def get_features_for_ticker(ticker_symbol):
    """Fetch recent data and compute features for a single prediction."""
    ticker = yf.Ticker(ticker_symbol)
    # We only need enough history to calculate the 50-day SMA
    df = ticker.history(period="6mo")
    
    if df.empty:
        return None
        
    # Replicate feature engineering
    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12)
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close'])
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close'])
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close'])
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close'])
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close'])
    
    df = df.dropna()
    
    if df.empty:
        return None
        
    features = [
        'Open', 'High', 'Low', 'Close', 'Volume',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    
    # Return the latest row of features, latest close, and a 30-day history for the sparkline
    latest_features = df[features].iloc[[-1]]
    latest_close = df['Close'].iloc[-1]
    
    history_df = df.tail(30)
    history = [{"date": str(idx.date()), "price": round(row['Close'], 2)} for idx, row in history_df.iterrows()]
    
    return latest_features, latest_close, history

@app.get("/")
def read_root():
    return {"message": "S&P 500 Trend Predictor API is running."}

@app.get("/api/predict/{ticker}")
def predict_trend(ticker: str):
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded on server.")
        
    ticker = ticker.upper()
    data = get_features_for_ticker(ticker)
    
    if data is None:
        raise HTTPException(status_code=404, detail="Could not fetch data or calculate features for ticker.")
        
    latest_features, latest_close, history = data
    
    # Predict
    prediction = model.predict(latest_features)[0]
    
    # We can also get probability if the model supports it
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
def get_trending():
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
    for t in trending_symbols:
        try:
            data = get_features_for_ticker(t)
            if data:
                features, close_price, history = data
                pred = model.predict(features)[0]
                prob = model.predict_proba(features)[0]
                conf = prob[pred]
                results.append({
                    "ticker": t,
                    "current_price": round(close_price, 2),
                    "predicted_trend": "UP" if pred == 1 else "DOWN",
                    "confidence": round(conf * 100, 2),
                    "history": history
                })
        except Exception as e:
            print(f"Error predicting {t}: {e}")
            
    return {"trending": results}
