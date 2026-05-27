import yfinance as yf
import pandas as pd
import numpy as np
import lightgbm as lgb
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score
import ta
import joblib
import os
import concurrent.futures

SECTORS = {
    "Technology": ["AAPL", "MSFT", "NVDA", "AMD", "AVGO", "ORCL", "CRM"],
    "Financial Services": ["JPM", "V", "BAC", "MA", "WFC", "C", "AXP"],
    "Healthcare": ["JNJ", "UNH", "LLY", "ABBV", "PFE", "MRK", "TMO"],
    "Consumer Cyclical": ["AMZN", "TSLA", "HD", "NKE", "SBUX", "MCD", "BKNG"],
    "Communication Services": ["META", "GOOGL", "NFLX", "DIS", "CMCSA", "VZ", "T"],
    "Industrials": ["CAT", "GE", "BA", "HON", "UNP", "UPS", "RTX"],
    "Consumer Defensive": ["WMT", "PG", "KO", "PEP", "COST", "PM", "MO"],
    "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PXD"],
    "Utilities": ["NEE", "DUK", "SO", "SRE", "AEP", "D", "EXC"],
    "Real Estate": ["PLD", "AMT", "EQIX", "CCI", "PSA", "O", "SPG"],
    "Basic Materials": ["LIN", "SHW", "NEM", "APD", "ECL", "FCX", "CTVA"]
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
    
    # Stationary features
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
    
    # Target
    shift_days = 5 if horizon == "5d" else 1
    future_close = df['Close'].shift(-shift_days)
    df['Target'] = (future_close > df['Close']).astype(float)
    df.loc[future_close.isna(), 'Target'] = np.nan
    
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna()
    df['Target'] = df['Target'].astype(int)
    return df

def train_sector_models():
    os.makedirs('models/sector_models', exist_ok=True)
    print("Fetching Macro Data...")
    macro_df = fetch_macro()
    
    features = [
        'Daily_Return', 'High_Low_Range', 'Close_vs_High', 'Volume_Change', 'Volume_vs_20d',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    
    tscv = TimeSeriesSplit(n_splits=5, gap=5)
    
    for sector, tickers in SECTORS.items():
        print(f"--- Training models for {sector} ---")
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
                
                curr_features = list(features)
                if use_macro:
                    curr_features.extend(['SPY_Return', 'SPY_SMA_50', 'VIX_Close'])
                    
                X = combined_df[curr_features]
                y = combined_df['Target']
                
                # Exponential decay sample weights
                n = len(X)
                half_life_days = 365
                decay = 0.5 ** (np.arange(n, 0, -1) / half_life_days)
                decay = decay / decay.sum() * n # Normalize to mean=1
                
                lgbm = lgb.LGBMClassifier(
                    n_estimators=150,
                    learning_rate=0.05,
                    max_depth=5,
                    num_leaves=31,
                    class_weight='balanced',
                    random_state=42,
                    verbose=-1
                )
                
                # Walk-forward validation
                oos_accs = []
                for train_idx, test_idx in tscv.split(X):
                    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
                    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
                    w_train = decay[train_idx]
                    
                    lgbm.fit(X_train, y_train, sample_weight=w_train)
                    preds = lgbm.predict(X_test)
                    oos_accs.append(accuracy_score(y_test, preds))
                    
                avg_oos_acc = np.mean(oos_accs)
                print(f"  {sector} {horizon} {'Macro' if use_macro else 'NoMacro'}: OOS Accuracy = {avg_oos_acc:.4f}")
                
                # Final training on all data with calibration
                calibrated_model = CalibratedClassifierCV(lgbm, method='isotonic', cv=TimeSeriesSplit(n_splits=5))
                # Pass the exponential decay sample weights to the calibrated fit
                calibrated_model.fit(X, y, sample_weight=decay)
                
                sec_name = sector.replace(" ", "_").lower()
                mac_str = "macro" if use_macro else "nomacro"
                filename = f"models/sector_models/{sec_name}_{horizon}_{mac_str}.joblib"
                joblib.dump(calibrated_model, filename)

if __name__ == "__main__":
    train_sector_models()
    print("All 44 Sector Models Trained Successfully!")
