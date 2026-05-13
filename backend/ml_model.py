import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, TimeSeriesSplit, GridSearchCV
from sklearn.metrics import accuracy_score
import ta
import joblib
import os

def fetch_data(ticker_symbol="SPY", period="10y"):
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
        'Open', 'High', 'Low', 'Close', 'Volume',
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
    
    print("Fine-Tuning Random Forest Classifier using GridSearchCV on generalized data...")
    
    param_grid = {
        'n_estimators': [100, 200],
        'max_depth': [5, 10, None],
        'min_samples_split': [10, 20],
        'class_weight': ['balanced', {0: 1, 1: 1.2}]
    }
    
    rf = RandomForestClassifier(random_state=42)
    # Use TimeSeriesSplit for cross-validation to prevent lookahead bias
    tscv = TimeSeriesSplit(n_splits=3)
    
    grid_search = GridSearchCV(estimator=rf, param_grid=param_grid, cv=tscv, n_jobs=-1, scoring='accuracy', verbose=1)
    grid_search.fit(X_train, y_train)
    
    print(f"Best Parameters: {grid_search.best_params_}")
    
    model = grid_search.best_estimator_
    
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
