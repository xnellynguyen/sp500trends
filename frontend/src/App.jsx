import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Search, X, Calendar, HelpCircle, Settings } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid } from 'recharts';
import './index.css';

const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:8000' 
  : 'https://sp500-predictor-374424962069.us-central1.run.app';

function App() {
  const [tickers, setTickers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [finnhubKey, setFinnhubKey] = useState(localStorage.getItem('FINNHUB_KEY') || import.meta.env.VITE_FINNHUB_KEY || '');
  const [keyInput, setKeyInput] = useState('');
  const [livePrices, setLivePrices] = useState({});
  const [flashStates, setFlashStates] = useState({});
  const wsRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Modal State
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [intradayData, setIntradayData] = useState([]);
  const [isLoadingIntraday, setIsLoadingIntraday] = useState(false);

  // Model parameters
  const [horizon, setHorizon] = useState('1d');
  const [useMacro, setUseMacro] = useState(false);
  const [isFetchingDashboard, setIsFetchingDashboard] = useState(false);
  
  const isInitialMount = useRef(true);
  const tickersRef = useRef([]);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  // Fetch initial predictions from our Python backend
  useEffect(() => {
    if (isInitialMount.current) {
      fetchTrending();
      isInitialMount.current = false;
    } else {
      recalculateCurrentTickers();
    }
  }, [horizon, useMacro]);

  const recalculateCurrentTickers = () => {
    if (tickersRef.current.length === 0) return;
    
    setIsFetchingDashboard(true);
    const symbols = tickersRef.current.map(t => t.ticker);
    
    fetch(`${API_BASE_URL}/api/predict_batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers: symbols,
        horizon: horizon,
        macro: useMacro ? "true" : "false"
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.results) {
          setTickers(data.results);
        }
      })
      .catch(err => console.error("Failed to recalculate tickers.", err))
      .finally(() => setIsFetchingDashboard(false));
  };

  const fetchTrending = () => {
    setIsFetchingDashboard(true);
    fetch(`${API_BASE_URL}/api/trending?horizon=${horizon}&macro=${useMacro}`)
      .then(res => res.json())
      .then(data => {
        if (data.trending) {
          setTickers(data.trending);
          const initialPrices = {};
          data.trending.forEach(t => initialPrices[t.ticker] = t.current_price);
          setLivePrices(initialPrices);
        }
      })
      .catch(err => console.error("Failed to fetch trending from backend. Make sure FastAPI is running.", err))
      .finally(() => setIsFetchingDashboard(false));
  };

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

  // Search logic
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    
    if (val.trim() === '') {
      setSuggestions([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        setSuggestions(data.results || []);
      } catch (err) {
        console.error("Search error", err);
      }
    }, 300);
  };

  const handlePredictTicker = async (tickerSymbol) => {
    if (!tickerSymbol) return;
    setIsSearching(true);
    setSuggestions([]);
    setSearchQuery('');
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/predict/${tickerSymbol}?horizon=${horizon}&macro=${useMacro}`);
      if (!res.ok) throw new Error("Not found or model error");
      const data = await res.json();
      
      if (!tickers.find(t => t.ticker === data.ticker)) {
        setTickers(prev => [data, ...prev]);
        setLivePrices(prev => ({ ...prev, [data.ticker]: data.current_price }));
        
        if (wsRef.current && wsRef.current.readyState === 1) {
          wsRef.current.send(JSON.stringify({ 'type': 'subscribe', 'symbol': data.ticker }));
        }
      }
    } catch (err) {
      alert(`Error fetching prediction for ${tickerSymbol}.`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCardClick = async (ticker) => {
    setExpandedTicker(ticker);
    setIsLoadingIntraday(true);
    setIntradayData([]);
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/intraday/${ticker.ticker}`);
      const data = await res.json();
      setIntradayData(data.history || []);
    } catch (err) {
      console.error("Failed to fetch intraday data", err);
    } finally {
      setIsLoadingIntraday(false);
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

      <header className="header" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 className="title"><Activity color="var(--accent)" /> AI Trend Predictor</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
            <Calendar size={14} />
            <span>{currentDate}</span>
          </div>
        </div>
        <div className="search-container" style={{ position: 'relative', marginTop: '0.5rem' }}>
          <form onSubmit={(e) => { e.preventDefault(); handlePredictTicker(searchQuery); }} style={{ display: 'flex', gap: '0.5rem' }}>
            <input 
              type="text" 
              className="search-input" 
              placeholder="Search ticker or name (e.g. Apple)" 
              value={searchQuery}
              onChange={handleSearchChange}
              disabled={isSearching}
            />
            <button type="submit" className="btn" disabled={isSearching}>
              {isSearching ? '...' : <Search size={18} />}
            </button>
          </form>
          
          {suggestions.length > 0 && (
            <div className="suggestions-dropdown">
              {suggestions.map((s, idx) => (
                <div 
                  key={idx} 
                  className="suggestion-item"
                  onClick={() => handlePredictTicker(s.symbol)}
                >
                  <span className="suggestion-symbol">{s.symbol}</span>
                  <span className="suggestion-name">{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="settings-bar" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', background: 'var(--card-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'bold' }}>
          <Settings size={18} /> Model Parameters
        </div>
        
        <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Horizon:</span>
          <button 
            onClick={() => setHorizon('1d')}
            style={{ cursor: 'pointer', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', border: horizon === '1d' ? '1px solid var(--accent)' : '1px solid var(--border-color)', background: horizon === '1d' ? 'var(--accent)' : 'transparent', color: horizon === '1d' ? '#fff' : 'var(--text-main)', transition: 'all 0.2s' }}
          >
            1-Day
          </button>
          <button 
            onClick={() => setHorizon('5d')}
            style={{ cursor: 'pointer', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', border: horizon === '5d' ? '1px solid var(--accent)' : '1px solid var(--border-color)', background: horizon === '5d' ? 'var(--accent)' : 'transparent', color: horizon === '5d' ? '#fff' : 'var(--text-main)', transition: 'all 0.2s' }}
          >
            5-Day
          </button>
        </div>

        <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Macro Features:</span>
          <button 
            onClick={() => setUseMacro(false)}
            style={{ cursor: 'pointer', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', border: !useMacro ? '1px solid var(--accent)' : '1px solid var(--border-color)', background: !useMacro ? 'var(--accent)' : 'transparent', color: !useMacro ? '#fff' : 'var(--text-main)', transition: 'all 0.2s' }}
          >
            Off
          </button>
          <button 
            onClick={() => setUseMacro(true)}
            style={{ cursor: 'pointer', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', border: useMacro ? '1px solid var(--accent)' : '1px solid var(--border-color)', background: useMacro ? 'var(--accent)' : 'transparent', color: useMacro ? '#fff' : 'var(--text-main)', transition: 'all 0.2s' }}
          >
            On
          </button>
          <div title="If ON, the model will analyze the VIX (Volatility Index) and the S&P 500 trend alongside the stock to avoid bull traps during market panics." style={{ display: 'flex', cursor: 'help', marginLeft: '4px' }}>
            <HelpCircle size={16} color="var(--text-muted)" />
          </div>
        </div>
        
        {isFetchingDashboard && <div style={{marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--accent)'}}>Recalculating Models...</div>}
      </div>

      <div className="dashboard">
        {tickers.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 1rem' }}>
            <Activity size={48} color="var(--accent)" style={{ marginBottom: '1rem', animation: 'pulse 2s infinite' }} />
            <h2 style={{ color: 'var(--text-main)', marginBottom: '0.5rem' }}>Loading Predictions...</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              {isFetchingDashboard ? 'Waking up the server & downloading live market data. This may take up to a minute on first load.' : 'No data available. Check your connection.'}
            </p>
          </div>
        )}
        {tickers.map(ticker => {
          const price = livePrices[ticker.ticker] || ticker.current_price;
          const flash = flashStates[ticker.ticker];
          
          return (
            <div key={ticker.ticker} className="card" onClick={() => handleCardClick(ticker)} style={{ cursor: 'pointer' }}>
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
              
              {ticker.history && ticker.history.length > 0 && (
                <div style={{ width: '100%', height: '220px', marginTop: '1.5rem' }} onClick={e => e.stopPropagation()}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ticker.history} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="var(--text-muted)" 
                        fontSize={12}
                        tickMargin={10}
                        tickFormatter={(str) => {
                          const date = new Date(str);
                          return `${date.getMonth()+1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis 
                        domain={['auto', 'auto']} 
                        stroke="var(--text-muted)" 
                        fontSize={12}
                        tickFormatter={(val) => `$${val}`}
                        width={60}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-main)' }}
                        itemStyle={{ color: 'var(--text-main)', fontWeight: 'bold' }}
                        labelStyle={{ color: 'var(--text-muted)', marginBottom: '5px' }}
                        formatter={(value) => [`$${value.toFixed(2)}`, 'Close Price']}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="price" 
                        stroke={ticker.predicted_trend === 'UP' ? 'var(--up-color)' : 'var(--down-color)'} 
                        strokeWidth={2} 
                        dot={false}
                        activeDot={{ r: 6, fill: 'var(--text-main)' }} 
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {expandedTicker && (
        <div className="modal-overlay" onClick={() => setExpandedTicker(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setExpandedTicker(null)}>
              <X size={24} />
            </button>
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {expandedTicker.ticker} Intraday Movement
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>1-Day Chart (5-minute intervals)</p>
            </div>
            
            <div style={{ width: '100%', height: '400px' }}>
              {isLoadingIntraday ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  Loading intraday data...
                </div>
              ) : intradayData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={intradayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="var(--text-muted)" 
                      fontSize={12}
                      tickMargin={10}
                      minTickGap={30}
                    />
                    <YAxis 
                      domain={['auto', 'auto']} 
                      stroke="var(--text-muted)" 
                      fontSize={12}
                      tickFormatter={(val) => `$${val}`}
                      width={60}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-main)' }}
                      itemStyle={{ color: 'var(--text-main)', fontWeight: 'bold' }}
                      labelStyle={{ color: 'var(--text-muted)', marginBottom: '5px' }}
                      formatter={(value) => [`$${value.toFixed(2)}`, 'Price']}
                      labelFormatter={(label) => `Time: ${label}`}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="price" 
                      stroke="var(--accent)"
                      strokeWidth={2} 
                      dot={false}
                      activeDot={{ r: 6, fill: 'var(--accent)' }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  No intraday data available today.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
