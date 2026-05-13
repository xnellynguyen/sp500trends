import pandas as pd
import yfinance as yf
import ta
import joblib
import os
from sklearn.metrics import classification_report, accuracy_score

def prepare_data(ticker_symbol, start_date, end_date):
    print(f"Fetching data for {ticker_symbol} from {start_date} to {end_date}...")
    df = yf.download(ticker_symbol, start=start_date, end=end_date, progress=False)
    
    if df.empty:
        return df
        
    # Flaten multi-index columns if present (yfinance behavior)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    # Feature Engineering (must match ml_model.py exactly)
    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12)
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close'])
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close'])
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close'])
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close'])
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close'])
    
    # Target: 1 if next day's close > today's close, else 0
    df['Target'] = (df['Close'].shift(-1) > df['Close']).astype(int)
    df = df.dropna()
    
    return df

def run_backtest(ticker="SPY"):
    print(f"\n--- Backtesting AI Model on {ticker} ---")
    model_path = os.path.join('models', 'rf_model.joblib')
    if not os.path.exists(model_path):
        print(f"Model not found at {model_path}!")
        return None
        
    model = joblib.load(model_path)
    
    # Test on completely unseen recent data
    df = prepare_data(ticker, "2023-01-01", "2026-05-12")
    
    if df.empty:
        print("No data fetched.")
        return None
        
    features = [
        'Open', 'High', 'Low', 'Close', 'Volume',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    
    X = df[features]
    y_true = df['Target']
    
    # Make Predictions
    predictions = model.predict(X)
    df['Prediction'] = predictions
    
    # 1. Classification Metrics
    print("\n--- Classification Performance ---")
    acc = accuracy_score(y_true, predictions)
    print(f"Accuracy: {acc * 100:.2f}%\n")
    print(classification_report(y_true, predictions, target_names=['DOWN (0)', 'UP (1)']))
    
    # 2. Financial Metrics (Strategy vs Buy & Hold)
    # Calculate daily returns
    df['Daily_Return'] = df['Close'].pct_change().shift(-1)
    
    # Strategy: Buy (1x return) if AI predicts UP, Cash (0x return) if AI predicts DOWN
    df['Strategy_Return'] = df['Prediction'] * df['Daily_Return']
    
    # Drop the last row because shift(-1) creates a NaN return
    df = df.dropna()
    
    df['Cumulative_Market'] = (1 + df['Daily_Return']).cumprod()
    df['Cumulative_Strategy'] = (1 + df['Strategy_Return']).cumprod()
    
    market_return = (df['Cumulative_Market'].iloc[-1] - 1) * 100
    strategy_return = (df['Cumulative_Strategy'].iloc[-1] - 1) * 100
    
    print("--- Financial Performance (2023 - 2026) ---")
    print(f"Buy & Hold Return:   {market_return:.2f}%")
    print(f"AI Strategy Return:  {strategy_return:.2f}%")
    
    # Win Rate of Trades Taken
    trades_taken = df[df['Prediction'] == 1]
    winning_trades = trades_taken[trades_taken['Daily_Return'] > 0]
    win_rate = len(winning_trades) / len(trades_taken) if len(trades_taken) > 0 else 0
    print(f"Strategy Win Rate:   {win_rate * 100:.2f}% (Out of {len(trades_taken)} trades taken)")
    
    return df

if __name__ == "__main__":
    # Test on a few different assets to see generalizability
    run_backtest("SPY")
    run_backtest("AAPL")
    run_backtest("TSLA")
