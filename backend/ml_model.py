import yfinance as yf
import pandas as pd
import numpy as np
import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score
import ta
import joblib
import os

def fetch_data(ticker_symbol="SPY", period="10y"):
    print(f"Fetching data for {ticker_symbol}...")
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.history(period=period)
    
    if hasattr(df.index, 'tz_localize'): df.index = df.index.tz_localize(None)
    
    # Drop rows with NaN or zero volume
    df = df.dropna()
    df = df[df['Volume'] > 0]
    return df

def create_features(df):
    """
    Generate technical indicators to be used as features.
    """
    df = df.copy()
    
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
    
    # Target Variable: 1 if tomorrow's close is higher than today's close, 0 otherwise
    future_close = df['Close'].shift(-1)
    df['Target'] = (future_close > df['Close']).astype(float)
    df.loc[future_close.isna(), 'Target'] = np.nan
    
    # Drop NaNs created by indicators
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna()
    df['Target'] = df['Target'].astype(int)
    
    return df

def train_and_save_model(tickers=["SPY", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META"]):
    print("Fetching and combining data for multiple tickers to prevent overfitting...")
    
    all_data = []
    for t in tickers:
        df = fetch_data(t, period="10y")
        if not df.empty:
            df = create_features(df)
            all_data.append(df)
            
    # Combine and sort by date so the train/test split works chronologically
    combined_df = pd.concat(all_data)
    combined_df = combined_df.sort_index()
    
    features = [
        'Daily_Return', 'High_Low_Range', 'Close_vs_High', 'Volume_Change', 'Volume_vs_20d',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    
    X = combined_df[features]
    y = combined_df['Target']
    
    # Split into train/test chronologically
    split_idx = int(len(combined_df) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    print("Training generalized LightGBM model...")
    
    # Exponential decay sample weights for training
    n = len(X_train)
    half_life_days = 365
    decay = 0.5 ** (np.arange(n, 0, -1) / half_life_days)
    w_train = decay / decay.sum() * n # Normalize to mean=1
    
    model = lgb.LGBMClassifier(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=5,
        num_leaves=31,
        class_weight='balanced',
        random_state=42,
        verbose=-1
    )
    
    model.fit(X_train, y_train, sample_weight=w_train)
    
    # Evaluate
    predictions = model.predict(X_test)
    acc = accuracy_score(y_test, predictions)
    print(f"Model Accuracy on generalized test set: {acc * 100:.2f}%")
    
    # Save the model
    os.makedirs('models', exist_ok=True)
    joblib.dump(model, 'models/rf_model.joblib')
    print("Model saved to models/rf_model.joblib")

if __name__ == "__main__":
    # We train a general model on a basket of tech/market leaders
    train_and_save_model(["SPY", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META"])
