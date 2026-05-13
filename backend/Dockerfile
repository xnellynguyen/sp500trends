FROM python:3.11-slim

WORKDIR /app

# Install only production dependencies
COPY requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt

# Copy application code and pre-trained models
COPY main.py .
COPY ml_model.py .
COPY train_all.py .
COPY models/ models/

# Cloud Run injects PORT env var
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
