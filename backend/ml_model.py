import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import ta
import joblib
import os

def fetch_data(ticker_symbol="SPY", period="5y"):
    print(f"Fetching data for {ticker_symbol}...")
    ticker = yf.Ticker(ticker_symbol)
    df = ticker.history(period=period)
    
    # Drop rows with NaN or zero volume
    df = df.dropna()
    df = df[df['Volume'] > 0]
    return df

def create_features(df):
    """
    Generate technical indicators to be used as features.
    """
    df = df.copy()
    
    # Technical Indicators using 'ta' library
    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12)
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close'])
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close'])
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close'])
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close'])
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close'])
    
    # Target Variable: 1 if tomorrow's close is higher than today's close, 0 otherwise
    df['Target'] = np.where(df['Close'].shift(-1) > df['Close'], 1, 0)
    
    # Drop NaNs created by indicators
    df = df.dropna()
    
    return df

def train_and_save_model(ticker="SPY"):
    df = fetch_data(ticker)
    df = create_features(df)
    
    features = [
        'Open', 'High', 'Low', 'Close', 'Volume',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    
    X = df[features]
    y = df['Target']
    
    # Split into train/test, preserving time series order
    # For a robust stock model, we shouldn't randomly shuffle, 
    # but for this basic baseline, we just take the last 20% as test
    split_idx = int(len(df) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    print("Training Random Forest Classifier...")
    model = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
    model.fit(X_train, y_train)
    
    # Evaluate
    predictions = model.predict(X_test)
    acc = accuracy_score(y_test, predictions)
    print(f"Model Accuracy on test set: {acc * 100:.2f}%")
    
    # Save the model
    os.makedirs('models', exist_ok=True)
    joblib.dump(model, 'models/rf_model.joblib')
    print("Model saved to models/rf_model.joblib")

if __name__ == "__main__":
    # We train a general model on SPY (S&P 500 ETF) as our baseline predictor
    train_and_save_model("SPY")
