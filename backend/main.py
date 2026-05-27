from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import ALLOWED_ORIGINS
import routers.predict as predict
import routers.earnings as earnings
import routers.history as history

app = FastAPI(title="S&P 500 Trend Predictor API")

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount APIRouters
app.include_router(predict.router)
app.include_router(earnings.router)
app.include_router(history.router)

@app.get("/")
def read_root():
    return {"message": "S&P 500 Trend Predictor API is running."}
