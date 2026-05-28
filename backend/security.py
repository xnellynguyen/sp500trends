import requests
from fastapi import Header, HTTPException
from config import SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_TOKEN

def verify_token(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ")[1]
    
    if token == SERVICE_TOKEN:
        return {"role": "service"}
        
    # Verify token against Supabase Auth API
    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": SUPABASE_ANON_KEY
    }
    try:
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            return res.json()
        
        detail = "Authentication failed: invalid token"
        try:
            err_data = res.json()
            if "error_description" in err_data:
                detail = f"Authentication failed: {err_data['error_description']}"
            elif "msg" in err_data:
                detail = f"Authentication failed: {err_data['msg']}"
        except Exception:
            pass
        raise HTTPException(status_code=401, detail=detail)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")
