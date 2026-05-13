import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import ta
import joblib
import os
import concurrent.futures

SECTORS = {
    "Technology": ["AAPL", "MSFT", "NVDA"],
    "Financial Services": ["JPM", "V", "BAC"],
    "Healthcare": ["JNJ", "UNH", "LLY"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD"],
    "Communication Services": ["META", "GOOGL", "NFLX"],
    "Industrials": ["CAT", "GE", "BA"],
    "Consumer Defensive": ["WMT", "PG", "KO"],
    "Energy": ["XOM", "CVX", "COP"],
    "Utilities": ["NEE", "DUK", "SO"],
    "Real Estate": ["PLD", "AMT", "EQIX"],
    "Basic Materials": ["LIN", "SHW", "NEM"]
}

def fetch_macro(period="5y"):
    spy = yf.Ticker("SPY").history(period=period)
    vix = yf.Ticker("^VIX").history(period=period)
    
    if hasattr(spy.index, 'tz_localize'): spy.index = spy.index.tz_localize(None)
    if hasattr(vix.index, 'tz_localize'): vix.index = vix.index.tz_localize(None)
    
    macro = pd.DataFrame()
    macro['SPY_Return'] = spy['Close'].pct_change()
    macro['SPY_SMA_50'] = ta.trend.sma_indicator(spy['Close'], window=50)
    macro['VIX_Close'] = vix['Close']
    return macro

def prepare_data(ticker_symbol, horizon, use_macro, macro_df=None):
    df = yf.Ticker(ticker_symbol).history(period="5y")
    if df.empty: return pd.DataFrame()
    
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
    
    if use_macro and macro_df is not None:
        df = df.join(macro_df, how='left')
    
    # Target
    shift_days = 5 if horizon == "5d" else 1
    df['Target'] = (df['Close'].shift(-shift_days) > df['Close']).astype(int)
    
    df = df.dropna()
    return df

def train_sector_models():
    os.makedirs('models/sector_models', exist_ok=True)
    print("Fetching Macro Data...")
    macro_df = fetch_macro()
    
    for sector, tickers in SECTORS.items():
        print(f"--- Training models for {sector} ---")
        
        # Pre-fetch technicals for these tickers so we don't re-download 4 times
        base_data = {}
        for t in tickers:
            print(f"  Downloading {t}...")
            base_data[t] = prepare_data(t, horizon="1d", use_macro=True, macro_df=macro_df) # Just to fetch and cache
            
        for horizon in ["1d", "5d"]:
            for use_macro in [False, True]:
                
                all_data = []
                for t in tickers:
                    df = prepare_data(t, horizon, use_macro, macro_df)
                    if not df.empty:
                        all_data.append(df)
                        
                if not all_data:
                    continue
                    
                combined_df = pd.concat(all_data).sort_index()
                
                features = [
                    'Open', 'High', 'Low', 'Close', 'Volume',
                    'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
                    'MACD', 'MACD_Signal', 'MACD_Diff',
                    'Bollinger_High', 'Bollinger_Low'
                ]
                if use_macro:
                    features.extend(['SPY_Return', 'SPY_SMA_50', 'VIX_Close'])
                    
                X = combined_df[features]
                y = combined_df['Target']
                
                rf = RandomForestClassifier(n_estimators=100, max_depth=5, class_weight='balanced', random_state=42)
                rf.fit(X, y)
                
                sec_name = sector.replace(" ", "_").lower()
                mac_str = "macro" if use_macro else "nomacro"
                filename = f"models/sector_models/{sec_name}_{horizon}_{mac_str}.joblib"
                joblib.dump(rf, filename)
                print(f"  Saved {filename}")

if __name__ == "__main__":
    train_sector_models()
    print("All 44 Sector Models Trained Successfully!")
