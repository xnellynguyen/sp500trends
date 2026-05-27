FROM python:3.11-slim

WORKDIR /app

# Install only production dependencies
COPY requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt

# Copy all application code
COPY . .

# Cloud Run injects PORT env var
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]

