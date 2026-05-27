from fastapi import APIRouter, Depends
from security import verify_token
from data_fetcher import fetch_earnings_from_fmp

router = APIRouter()

@router.get("/api/earnings/{ticker}")
def get_earnings_info(ticker: str, user=Depends(verify_token)):
    """Fetch earnings calendar dates, consensus, and surprises from FMP."""
    ticker = ticker.upper()
    try:
        fmp_data = fetch_earnings_from_fmp(ticker)
        if fmp_data:
            return fmp_data
            
        # Return empty structured schema if FMP fails or is not configured
        return {
            "ticker": ticker,
            "next_earnings_date": None,
            "days_until": -1,
            "is_warning": False,
            "analyst": {
                "buy_count": 0,
                "total_count": 0,
                "consensus": "UNKNOWN"
            },
            "historical_beats": {
                "beat_rate": None,
                "quarters_checked": 0
            }
        }
    except Exception as e:
        print(f"Earnings route outer error for {ticker}: {e}")
        return {"error": f"Failed to fetch earnings info: {str(e)}"}
