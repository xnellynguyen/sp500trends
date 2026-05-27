import pandas as pd
import numpy as np
import ta
from datetime import datetime, timedelta
from data_fetcher import fetch_polygon_aggs

def get_signals_from_features(features, close_price, use_macro: bool):
    """Translate raw features into directional signals (UP/DOWN/NEUTRAL) for display."""
    signals = {}
    
    rsi = float(features['RSI_14'].iloc[0])
    signals['rsi'] = {
        "value": round(rsi, 2),
        "direction": "UP" if rsi < 45 else "DOWN" if rsi > 55 else "NEUTRAL"
    }
    
    macd_diff = float(features['MACD_Diff'].iloc[0])
    signals['macd'] = {
        "value": round(macd_diff, 3), 
        "direction": "UP" if macd_diff > 0 else "DOWN"
    }
    
    sma20 = float(features['SMA_20'].iloc[0])
    signals['sma20'] = {
        "value": round(sma20, 2), 
        "direction": "UP" if close_price > sma20 else "DOWN"
    }
    
    b_high = float(features['Bollinger_High'].iloc[0])
    b_low = float(features['Bollinger_Low'].iloc[0])
    signals['bollinger'] = {
        "value": round(close_price, 2), 
        "direction": "UP" if close_price < b_low * 1.05 else "DOWN" if close_price > b_high * 0.95 else "NEUTRAL"
    }
    
    if use_macro:
        vix = float(features['VIX_Close'].iloc[0])
        signals['vix'] = {
            "value": round(vix, 2), 
            "direction": "DOWN" if vix > 20 else "UP"
        }
        
    return signals

def get_features_for_ticker(ticker_symbol, use_macro: bool = False, macro_df=None):
    """Fetch history, compute indicators, join macro if enabled, and extract the latest feature row."""
    start_date = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    df = fetch_polygon_aggs(ticker_symbol, start_date, end_date)
    
    if df.empty: return None
        
    df['Daily_Return'] = df['Close'].pct_change()
    df['High_Low_Range'] = (df['High'] - df['Low']) / df['Close']
    df['Close_vs_High'] = (df['Close'] - df['High']) / df['High']
    df['Volume_Change'] = df['Volume'].pct_change()
    df['Volume_vs_20d'] = df['Volume'] / df['Volume'].rolling(20).mean()
        
    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20) / df['Close'] - 1
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50) / df['Close'] - 1
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12) / df['Close'] - 1
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close']) / df['Close']
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close']) / df['Close']
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close']) / df['Close']
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close']) / df['Close'] - 1
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close']) / df['Close'] - 1
    
    if use_macro and macro_df is not None:
        df = df.join(macro_df, how='left')
    
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna()
    if df.empty: return None
        
    features = [
        'Daily_Return', 'High_Low_Range', 'Close_vs_High', 'Volume_Change', 'Volume_vs_20d',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    if use_macro:
        features.extend(['SPY_Return', 'SPY_SMA_50', 'VIX_Close'])
        
    latest_features = df[features].iloc[[-1]]
    latest_close = df['Close'].iloc[-1]
    
    history_df = df.tail(30)
    history = [{"date": str(idx.date()), "price": round(row['Close'], 2)} for idx, row in history_df.iterrows()]
    
    return latest_features, latest_close, history
