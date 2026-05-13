import pandas as pd
import yfinance as yf
import ta
import joblib
import os
import warnings
from sklearn.metrics import classification_report, accuracy_score
warnings.filterwarnings('ignore')

# Re-use Sector mapping logic
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

def prepare_data(ticker_symbol, start_date, end_date, horizon, use_macro):
    print(f"Fetching data for {ticker_symbol}...")
    df = yf.download(ticker_symbol, start=start_date, end=end_date, progress=False)
    if df.empty: return df
        
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df['SMA_20'] = ta.trend.sma_indicator(df['Close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['Close'], window=50)
    df['EMA_12'] = ta.trend.ema_indicator(df['Close'], window=12)
    df['RSI_14'] = ta.momentum.rsi(df['Close'], window=14)
    df['MACD'] = ta.trend.macd(df['Close'])
    df['MACD_Signal'] = ta.trend.macd_signal(df['Close'])
    df['MACD_Diff'] = ta.trend.macd_diff(df['Close'])
    df['Bollinger_High'] = ta.volatility.bollinger_hband(df['Close'])
    df['Bollinger_Low'] = ta.volatility.bollinger_lband(df['Close'])
    
    if use_macro:
        spy = yf.download("SPY", start=start_date, end=end_date, progress=False)
        vix = yf.download("^VIX", start=start_date, end=end_date, progress=False)
        if isinstance(spy.columns, pd.MultiIndex): spy.columns = spy.columns.get_level_values(0)
        if isinstance(vix.columns, pd.MultiIndex): vix.columns = vix.columns.get_level_values(0)
        
        macro_df = pd.DataFrame()
        macro_df['SPY_Return'] = spy['Close'].pct_change()
        macro_df['SPY_SMA_50'] = ta.trend.sma_indicator(spy['Close'], window=50)
        macro_df['VIX_Close'] = vix['Close']
        df = df.join(macro_df, how='left')
    
    shift_days = 5 if horizon == "5d" else 1
    df['Target'] = (df['Close'].shift(-shift_days) > df['Close']).astype(int)
    
    # Store future return for backtesting profit/loss
    df['Future_Return'] = df['Close'].shift(-shift_days) / df['Close'] - 1
    
    df = df.dropna()
    return df

def run_backtest(ticker="SPY", horizon="1d", use_macro=False):
    print(f"\n========== BACKTEST: {ticker} | Horizon: {horizon} | Macro: {use_macro} ==========")
    sector = get_sector(ticker)
    mac_str = "macro" if use_macro else "nomacro"
    
    model_path = os.path.join('models', 'sector_models', f"{sector}_{horizon}_{mac_str}.joblib")
    if not os.path.exists(model_path):
        model_path = os.path.join('models', 'sector_models', f"technology_{horizon}_{mac_str}.joblib")
        
    print(f"Loaded Model: {model_path}")
    model = joblib.load(model_path)
    
    df = prepare_data(ticker, "2023-01-01", "2026-05-12", horizon, use_macro)
    if df.empty: return None
        
    features = [
        'Open', 'High', 'Low', 'Close', 'Volume',
        'SMA_20', 'SMA_50', 'EMA_12', 'RSI_14',
        'MACD', 'MACD_Signal', 'MACD_Diff',
        'Bollinger_High', 'Bollinger_Low'
    ]
    if use_macro: features.extend(['SPY_Return', 'SPY_SMA_50', 'VIX_Close'])
    
    X = df[features]
    y_true = df['Target']
    
    predictions = model.predict(X)
    df['Prediction'] = predictions
    
    acc = accuracy_score(y_true, predictions)
    print(f"Classification Accuracy: {acc * 100:.2f}%")
    
    # Financial Simulation
    # Since we trade chunks, if horizon is 5d, we hold for 5 days. For simple simulation, 
    # we just calculate the compounding of non-overlapping trades, or assume independent allocations.
    # We will simulate trading the 1-day or 5-day periods
    shift_days = 5 if horizon == "5d" else 1
    
    # Buy & Hold Return from start to end
    market_return = (df['Close'].iloc[-1] / df['Close'].iloc[0] - 1) * 100
    
    # Strategy Return
    # We buy when Prediction is 1, and capture the future return.
    # To properly compound, we only take the return of the days we are invested.
    # For a 5-day horizon, this simplified cumulative sum assumes we can re-allocate daily, 
    # which implies 1/5th capital allocation. For simplicity, we just look at average return per trade.
    
    trades = df[df['Prediction'] == 1]
    if len(trades) > 0:
        win_rate = len(trades[trades['Future_Return'] > 0]) / len(trades)
        # Simplified compounding approach (daily equivalent)
        df['Daily_Equiv'] = df['Close'].pct_change().shift(-1)
        df['Strat_Daily'] = df['Prediction'] * df['Daily_Equiv']
        df = df.dropna()
        strategy_return = ((1 + df['Strat_Daily']).cumprod().iloc[-1] - 1) * 100
    else:
        win_rate = 0
        strategy_return = 0

    print(f"Buy & Hold Return:   {market_return:.2f}%")
    print(f"AI Strategy Return:  {strategy_return:.2f}%")
    print(f"Strategy Win Rate:   {win_rate * 100:.2f}% (Out of {len(trades)} trades taken)\n")
    
    return df

if __name__ == "__main__":
    run_backtest("SPY", horizon="1d", use_macro=False)
    run_backtest("SPY", horizon="5d", use_macro=True)
    
    run_backtest("TSLA", horizon="1d", use_macro=False)
    run_backtest("TSLA", horizon="5d", use_macro=True)
