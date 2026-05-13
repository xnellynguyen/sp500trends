import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Search } from 'lucide-react';
import './index.css';

const API_BASE_URL = 'http://localhost:8000';

function App() {
  const [tickers, setTickers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [finnhubKey, setFinnhubKey] = useState(localStorage.getItem('FINNHUB_KEY') || '');
  const [keyInput, setKeyInput] = useState('');
  const [livePrices, setLivePrices] = useState({});
  const [flashStates, setFlashStates] = useState({});
  const wsRef = useRef(null);

  // Fetch initial predictions from our Python backend
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/trending`)
      .then(res => res.json())
      .then(data => {
        if (data.trending) {
          setTickers(data.trending);
          const initialPrices = {};
          data.trending.forEach(t => initialPrices[t.ticker] = t.current_price);
          setLivePrices(initialPrices);
        }
      })
      .catch(err => console.error("Failed to fetch trending from backend. Make sure FastAPI is running.", err));
  }, []);

  // Connect to Finnhub WebSocket
  useEffect(() => {
    if (!finnhubKey) return;

    const ws = new WebSocket(`wss://ws.finnhub.io?token=${finnhubKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      tickers.forEach(t => {
        ws.send(JSON.stringify({ 'type': 'subscribe', 'symbol': t.ticker }));
      });
    };

    ws.onmessage = (event) => {
      const response = JSON.parse(event.data);
      if (response.type === 'trade') {
        response.data.forEach(trade => {
          const symbol = trade.s;
          const price = trade.p;
          
          setLivePrices(prev => {
            const oldPrice = prev[symbol];
            if (oldPrice && price !== oldPrice) {
              setFlashStates(f => ({ ...f, [symbol]: price > oldPrice ? 'up' : 'down' }));
              setTimeout(() => setFlashStates(f => ({ ...f, [symbol]: null })), 500);
            }
            return { ...prev, [symbol]: price };
          });
        });
      }
    };

    return () => {
      if (ws.readyState === 1) {
        ws.close();
      }
    };
  }, [finnhubKey, tickers]);

  // Mock ticking if no API key is provided (for demonstration)
  useEffect(() => {
    if (finnhubKey) return;
    const interval = setInterval(() => {
      setLivePrices(prev => {
        const newPrices = { ...prev };
        Object.keys(newPrices).forEach(sym => {
          const change = (Math.random() - 0.5) * 0.5;
          newPrices[sym] = newPrices[sym] + change;
          setFlashStates(f => ({ ...f, [sym]: change > 0 ? 'up' : 'down' }));
          setTimeout(() => setFlashStates(f => ({ ...f, [sym]: null })), 500);
        });
        return newPrices;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [finnhubKey]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/predict/${searchQuery}`);
      if (!res.ok) throw new Error("Not found or model error");
      const data = await res.json();
      
      // Add to our tracked tickers if not already there
      if (!tickers.find(t => t.ticker === data.ticker)) {
        setTickers(prev => [data, ...prev]);
        setLivePrices(prev => ({ ...prev, [data.ticker]: data.current_price }));
        
        // Subscribe to websocket if active
        if (wsRef.current && wsRef.current.readyState === 1) {
          wsRef.current.send(JSON.stringify({ 'type': 'subscribe', 'symbol': data.ticker }));
        }
      }
      setSearchQuery('');
    } catch (err) {
      alert(`Error fetching prediction for ${searchQuery}.`);
    }
  };

  const saveApiKey = () => {
    localStorage.setItem('FINNHUB_KEY', keyInput);
    setFinnhubKey(keyInput);
  };

  return (
    <div className="container">
      {!finnhubKey && (
        <div className="config-banner">
          <strong>Running in Demo Mode:</strong> You are seeing mocked live prices. 
          To see real trades, get a free API key from Finnhub.io and enter it here:
          <input 
            type="text" 
            placeholder="Finnhub API Key" 
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            style={{ margin: '0 10px', padding: '5px' }}
          />
          <button onClick={saveApiKey} className="btn" style={{ padding: '5px 10px' }}>Save</button>
        </div>
      )}

      <header className="header">
        <h1 className="title"><Activity color="var(--accent)" /> AI Trend Predictor</h1>
        <form className="search-container" onSubmit={handleSearch}>
          <input 
            type="text" 
            className="search-input" 
            placeholder="Search ticker (e.g. TSLA)" 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn"><Search size={18} /></button>
        </form>
      </header>

      <div className="dashboard">
        {tickers.map(ticker => {
          const price = livePrices[ticker.ticker] || ticker.current_price;
          const flash = flashStates[ticker.ticker];
          
          return (
            <div key={ticker.ticker} className="card">
              <div className="card-header">
                <span className="ticker-name">{ticker.ticker}</span>
                <div className={`prediction-badge ${ticker.predicted_trend === 'UP' ? 'prediction-up' : 'prediction-down'}`}>
                  {ticker.predicted_trend === 'UP' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                  <span>{ticker.predicted_trend} ({ticker.confidence}%)</span>
                </div>
              </div>
              <div className={`live-price ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}>
                ${price.toFixed(2)}
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                AI Model Analysis indicates a {ticker.confidence}% probability of a {ticker.predicted_trend.toLowerCase()} trend.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
