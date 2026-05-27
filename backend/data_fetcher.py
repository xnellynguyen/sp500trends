import requests
import pandas as pd
import yfinance as yf
from datetime import datetime, date, timedelta
from config import POLYGON_API_KEY, FMP_API_KEY

def fetch_polygon_aggs(ticker, start_date, end_date, multiplier=1, timespan="day"):
    """Fetch daily or minute aggregations from Polygon with yfinance fallback."""
    if not POLYGON_API_KEY:
        try:
            df = yf.Ticker(ticker).history(start=start_date, end=end_date)
            if hasattr(df.index, 'tz') and df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            return df
        except Exception as e:
            print(f"yfinance direct fetch error for {ticker}: {e}")
            return pd.DataFrame()

    prefix = "I:" if ticker.startswith("^") else ""
    t = ticker.replace("^", "")
    url = f"https://api.polygon.io/v2/aggs/ticker/{prefix}{t}/range/{multiplier}/{timespan}/{start_date}/{end_date}?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}"
    try:
        res = requests.get(url, timeout=10)
        data = res.json()
        if data.get("status") in ("OK", "DELAYED") and data.get("results"):
            df = pd.DataFrame(data["results"])
            df['Date'] = pd.to_datetime(df['t'], unit='ms')
            if timespan == "day":
                df['Date'] = df['Date'].dt.normalize()
            df.set_index('Date', inplace=True)
            df.rename(columns={'o': 'Open', 'h': 'High', 'l': 'Low', 'c': 'Close', 'v': 'Volume'}, inplace=True)
            return df
    except Exception as e:
        print(f"Polygon fetch error for {ticker}: {e}")
    
    try:
        df = yf.Ticker(ticker).history(start=start_date, end=end_date)
        if hasattr(df.index, 'tz') and df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        return df
    except Exception as e:
        print(f"yfinance fallback fetch error for {ticker}: {e}")
    return pd.DataFrame()

def fetch_earnings_from_fmp(ticker):
    """Fetch earnings data, analyst consensus, and historical surprises from Financial Modeling Prep (FMP)."""
    if not FMP_API_KEY:
        print(f"FMP_API_KEY is not set. Skipping FMP fetch for {ticker}.")
        return None
        
    next_date = None
    days_until = -1
    is_warning = False
    consensus = "UNKNOWN"
    beat_rate = None
    quarters_checked = 0
    
    # Use the stable earnings endpoint to get historical and upcoming report dates
    url_earnings = f"https://financialmodelingprep.com/stable/earnings?symbol={ticker}&apikey={FMP_API_KEY}"
    try:
        res = requests.get(url_earnings, timeout=5)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list) and len(data) > 0:
                today = date.today()
                
                # Extract next earnings date (closest future date) and group past reports
                future_reports = []
                past_reports = []
                for item in data:
                    r_date_str = item.get('date')
                    if r_date_str:
                        try:
                            r_date = datetime.strptime(r_date_str, "%Y-%m-%d").date()
                            if r_date >= today:
                                future_reports.append((r_date, r_date_str))
                            else:
                                past_reports.append(item)
                        except Exception:
                            pass
                
                if future_reports:
                    future_reports = sorted(future_reports, key=lambda x: x[0])
                    next_date_val, next_date = future_reports[0]
                    days_until = (next_date_val - today).days
                    is_warning = 0 <= days_until <= 5
                
                # Compute beat rate from the 8 most recent past reports
                recent_past = past_reports[:8]
                quarters_checked = len(recent_past)
                beats = 0
                for item in recent_past:
                    act = item.get('epsActual')
                    est = item.get('epsEstimated')
                    if act is not None and est is not None:
                        if act > est:
                            beats += 1
                if quarters_checked > 0:
                    beat_rate = round(beats / quarters_checked, 2)
    except Exception as e:
        print(f"FMP stable earnings error for {ticker}: {e}")
        
    # Recommendations endpoint
    url_rec = f"https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/{ticker}?apikey={FMP_API_KEY}"
    try:
        res = requests.get(url_rec, timeout=5)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list) and len(data) > 0:
                latest = data[0]
                buy = latest.get('analystRatingsbuy', 0) + latest.get('analystRatingsStrongBuy', 0)
                sell = latest.get('analystRatingsSell', 0) + latest.get('analystRatingsStrongSell', 0)
                hold = latest.get('analystRatingsHold', 0)
                if buy > (sell + hold):
                    consensus = "BUY"
                elif sell > (buy + hold):
                    consensus = "SELL"
                elif (buy + sell + hold) > 0:
                    consensus = "HOLD"
    except Exception as e:
        print(f"FMP recommendations error for {ticker}: {e}")
        
    if next_date is None and consensus == "UNKNOWN" and beat_rate is None:
        return None
        
    return {
        "ticker": ticker,
        "next_earnings_date": next_date,
        "days_until": days_until,
        "is_warning": is_warning,
        "analyst": {
            "buy_count": 0,
            "total_count": 0,
            "consensus": consensus
        },
        "historical_beats": {
            "beat_rate": beat_rate,
            "quarters_checked": quarters_checked
        }
    }
