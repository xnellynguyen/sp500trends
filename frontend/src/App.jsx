import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Search, X, Calendar, HelpCircle, Settings, LogOut, AlertTriangle, Trash2, Filter, Plus, Zap } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid } from 'recharts';
import { supabase } from './supabaseClient';
import './index.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://sp500-predictor-697399258111.us-central1.run.app';

function App() {
  const [session, setSession] = useState(null);
  const [tickers, setTickers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [finnhubKey] = useState(() => import.meta.env.VITE_FINNHUB_KEY || '');

  const [livePrices, setLivePrices] = useState({});
  const [flashStates, setFlashStates] = useState({});
  const wsRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  const laymanExplanations = {
    rsi: { name: "Momentum (RSI)", desc: "Measures if the stock is overbought or oversold. High values mean it might pull back, low means it might bounce." },
    macd: { name: "Trend Strength (MACD)", desc: "Shows if the recent price trend is accelerating or slowing down." },
    sma20: { name: "Short-Term Trend (SMA)", desc: "Compares current price to the 20-day average to see if the immediate trend is up or down." },
    bollinger: { name: "Volatility (Bollinger)", desc: "Checks if the price is unusually high or low compared to its normal trading range." },
    vix: { name: "Market Fear (VIX)", desc: "Measures overall stock market anxiety. High fear often drags down individual stocks." }
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Modal State
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [intradayData, setIntradayData] = useState([]);
  const [isLoadingIntraday, setIsLoadingIntraday] = useState(false);
  const [earningsData, setEarningsData] = useState(null);
  const [isLoadingEarnings, setIsLoadingEarnings] = useState(false);

  // Model parameters
  const [horizon, setHorizon] = useState('1d');
  const [useMacro, setUseMacro] = useState(false);
  const [isFetchingDashboard, setIsFetchingDashboard] = useState(false);
  const [minConfidence, setMinConfidence] = useState(0);
  const [earningsMap, setEarningsMap] = useState({});
  const [isFetchingEarningsBatch, setIsFetchingEarningsBatch] = useState(false);
  const [sortOption, setSortOption] = useState('confidence'); // 'confidence', 'alphabetical', 'divergence'
  const [winRates, setWinRates] = useState({});
  const [trendingTickers, setTrendingTickers] = useState([]);
  const [isFetchingTrending, setIsFetchingTrending] = useState(false);
  const [showTrending, setShowTrending] = useState(false);
  const [expandedCards, setExpandedCards] = useState({});
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        setNotificationsEnabled(true);
      }
    } catch (e) {
      console.warn("Notification API not fully supported or accessible:", e);
    }
  }, []);

  const isInitialMount = useRef(true);
  const tickersRef = useRef([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  useEffect(() => {
    if (session) {
      if (isInitialMount.current) {
        loadWatchlist();
        isInitialMount.current = false;
      } else {
        loadWatchlist(); // Reload on parameter change
      }
    }
  }, [horizon, useMacro, session]);
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW Registered', reg))
        .catch(err => console.error('SW Registration failed', err));
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      alert("Notifications are not supported in this environment.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationsEnabled(true);
      // Here you would normally register for push and save to DB
    }
  };

  const logPrediction = async (ticker, horizonStr, trend, confidence, basePrice) => {
    if (!session) return;
    try {
      await supabase.from('predictions').insert({
        user_id: session.user.id,
        ticker,
        horizon: horizonStr,
        predicted_direction: trend,
        confidence: confidence / 100,
        base_price: basePrice
      });
    } catch (e) {
      console.error("Log error", e);
    }
  };

  const handleAddTrending = async (tickerSymbol, e) => {
    if (e) e.stopPropagation();
    try {
      const { error } = await supabase.from('watchlist').insert({
        user_id: session.user.id,
        ticker: tickerSymbol,
      });
      if (error) {
        if (error.code !== '23505') throw error;
      }
      // Remove from trending locally
      setTrendingTickers(prev => prev.filter(t => t.ticker !== tickerSymbol));
      // Reload watchlist
      loadWatchlist();
    } catch (err) {
      console.error("Failed to add trending ticker", err);
    }
  };

  const loadWinRates = async () => {
    if (!session) return;
    try {
      const { data, error } = await supabase
        .from('predictions')
        .select('ticker, resolved_correctly')
        .eq('user_id', session.user.id)
        .not('resolved_correctly', 'is', null);

      if (error) throw error;

      const rates = {};
      data.forEach(p => {
        if (!rates[p.ticker]) rates[p.ticker] = { total: 0, wins: 0 };
        rates[p.ticker].total += 1;
        if (p.resolved_correctly) rates[p.ticker].wins += 1;
      });

      const formatted = {};
      Object.keys(rates).forEach(t => {
        formatted[t] = {
          rate: Math.round((rates[t].wins / rates[t].total) * 100),
          total: rates[t].total
        };
      });

      setWinRates(formatted);
    } catch (e) {
      console.error("Failed to load win rates", e);
    }
  };

  const resolvePendingPredictions = async () => {
    if (!session) return;
    try {
      // Get all unresolved predictions for this user
      const { data: pending, error } = await supabase
        .from('predictions')
        .select('*')
        .eq('user_id', session.user.id)
        .is('resolved_correctly', null);

      if (error || !pending || pending.length === 0) return;

      const now = new Date();
      const matured = [];

      // Filter to predictions where enough time has passed
      for (const pred of pending) {
        if (!pred.base_price) continue;
        const createdAt = new Date(pred.created_at);
        const horizonDays = pred.horizon === '5d' ? 5 : 1;
        const targetDate = new Date(createdAt);
        targetDate.setDate(targetDate.getDate() + horizonDays);

        if (now < targetDate) continue;

        const dateStr = targetDate.toISOString().split('T')[0];
        matured.push({ ...pred, _targetDate: dateStr });
      }

      if (matured.length === 0) return;

      // Deduplicate ticker+date pairs for the API call
      const uniqueChecks = {};
      for (const pred of matured) {
        const key = `${pred.ticker}_${pred._targetDate}`;
        if (!uniqueChecks[key]) {
          uniqueChecks[key] = { ticker: pred.ticker, date: pred._targetDate };
        }
      }

      // Fetch actual historical prices from the backend
      const res = await fetch(`${API_BASE_URL}/api/historical_prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checks: Object.values(uniqueChecks) })
      });
      const { prices } = await res.json();

      // Resolve each prediction against the real price on the target date
      const updates = [];
      for (const pred of matured) {
        const key = `${pred.ticker}_${pred._targetDate}`;
        const actualPrice = prices[key];
        if (actualPrice == null) continue;

        const actualDirection = actualPrice > pred.base_price ? 'UP' : 'DOWN';
        const isCorrect = actualDirection === pred.predicted_direction;
        updates.push({ id: pred.id, resolved_correctly: isCorrect });
      }

      if (updates.length === 0) return;

      // Batch update resolved predictions
      for (const update of updates) {
        await supabase
          .from('predictions')
          .update({ resolved_correctly: update.resolved_correctly })
          .eq('id', update.id);
      }

      console.log(`Resolved ${updates.length} prediction(s) using historical prices`);

      // Reload win rates so the accuracy bars update
      loadWinRates();
    } catch (e) {
      console.error("Failed to resolve predictions:", e);
    }
  };

  const fetchEarningsForBatch = async (symbols) => {
    setIsFetchingEarningsBatch(true);
    const newEarnings = { ...earningsMap };

    // Fetch in parallel with a small delay to avoid hitting rate limits too fast
    // though FMP is usually okay with some concurrency
    const promises = symbols.map(async (symbol) => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/earnings/${symbol}`);
        const data = await response.json();
        if (!data.error) {
          newEarnings[symbol] = data;
        }
      } catch (e) {
        console.error(`Failed to fetch earnings for ${symbol}`, e);
      }
    });

    await Promise.all(promises);
    setEarningsMap(newEarnings);
    setIsFetchingEarningsBatch(false);
  };

  const loadWatchlist = async () => {
    setIsFetchingDashboard(true);
    try {
      const { data, error } = await supabase
        .from('watchlist')
        .select('*')
        .eq('user_id', session.user.id)
        .order('added_at', { ascending: true });

      if (error) throw error;

      if (data.length === 0) {
        setTickers([]);
        setIsFetchingDashboard(false);
        return;
      }

      loadWinRates();

      const symbols = data.map(d => d.ticker);

      // Fast path: fetch only the active horizon
      const resMain = await fetch(`${API_BASE_URL}/api/predict_batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: symbols, horizon: horizon, macro: useMacro ? "true" : "false" })
      }).then(r => r.json());

      const initialPrices = { ...livePrices };

      const baseTickers = (resMain.results || []).map(t => {
        logPrediction(t.ticker, horizon, t.predicted_trend, t.confidence, t.current_price);
        if (!initialPrices[t.ticker]) {
          initialPrices[t.ticker] = t.current_price;
        }

        const dbItem = data.find(d => d.ticker === t.ticker) || {};

        return {
          ...t,
          entry_price: dbItem.entry_price,
          entry_date: dbItem.entry_date,
          trend_1d: horizon === '1d' ? t.predicted_trend : null,
          trend_5d: horizon === '5d' ? t.predicted_trend : null,
          hasDivergence: false,
        };
      });

      setTickers(baseTickers);
      setLivePrices(initialPrices);
      setIsFetchingDashboard(false);

      // Fetch earnings for all tickers in background
      fetchEarningsForBatch(symbols);

      // Resolve any matured predictions in the background so accuracy bars populate
      resolvePendingPredictions();

      // Slow path: fetch the other horizon in the background for divergence detection
      const otherHorizon = horizon === '1d' ? '5d' : '1d';
      fetch(`${API_BASE_URL}/api/predict_batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: symbols, horizon: otherHorizon, macro: useMacro ? "true" : "false" })
      })
        .then(r => r.json())
        .then(resOther => {
          setTickers(currentTickers => {
            return currentTickers.map(t => {
              const otherT = (resOther.results || []).find(o => o.ticker === t.ticker);
              if (!otherT) return t;

              logPrediction(otherT.ticker, otherHorizon, otherT.predicted_trend, otherT.confidence, otherT.current_price);

              return {
                ...t,
                trend_1d: horizon === '1d' ? t.trend_1d : otherT.predicted_trend,
                trend_5d: horizon === '5d' ? t.trend_5d : otherT.predicted_trend,
                hasDivergence: t.predicted_trend !== otherT.predicted_trend
              };
            });
          });
        })
        .catch(err => console.error("Divergence fetch failed", err));

      if (wsRef.current && wsRef.current.readyState === 1) {
        symbols.forEach(sym => {
          wsRef.current.send(JSON.stringify({ 'type': 'subscribe', 'symbol': sym }));
        });
      }
    } catch (err) {
      console.error("Failed to load watchlist.", err);
      setIsFetchingDashboard(false);
    }
  };

  const addTicker = async (symbol) => {
    if (tickers.find(t => t.ticker === symbol)) return;
    try {
      await supabase.from('watchlist').insert({ user_id: session.user.id, ticker: symbol });
      loadWatchlist();
    } catch (e) {
      console.error(e);
    }
  };

  const removeTicker = async (symbol, e) => {
    e.stopPropagation();
    try {
      await supabase.from('watchlist').delete().eq('user_id', session.user.id).eq('ticker', symbol);
      setTickers(tickers.filter(t => t.ticker !== symbol));
      if (expandedTicker && expandedTicker.ticker === symbol) {
        setExpandedTicker(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const savePosition = async (symbol, priceStr, dateStr) => {
    const price = priceStr ? parseFloat(priceStr) : null;
    const date = dateStr ? dateStr : null;

    try {
      await supabase.from('watchlist').update({ entry_price: price, entry_date: date })
        .eq('user_id', session.user.id)
        .eq('ticker', symbol);

      setTickers(prev => prev.map(t => {
        if (t.ticker === symbol) {
          return { ...t, entry_price: price, entry_date: date };
        }
        return t;
      }));

      if (expandedTicker && expandedTicker.ticker === symbol) {
        setExpandedTicker(prev => ({ ...prev, entry_price: price, entry_date: date }));
      }
    } catch (err) {
      console.error("Failed to save position", err);
    }
  };

  const loadTrending = async () => {
    setIsFetchingTrending(true);
    setShowTrending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/trending?horizon=${horizon}&macro=${useMacro ? 'true' : 'false'}`);
      const data = await res.json();

      const newInitialPrices = { ...livePrices };
      (data.trending || []).forEach(t => {
        if (!newInitialPrices[t.ticker]) newInitialPrices[t.ticker] = t.current_price;
      });
      setLivePrices(newInitialPrices);
      setTrendingTickers(data.trending || []);
    } catch (err) {
      console.error("Failed to load trending", err);
    } finally {
      setIsFetchingTrending(false);
    }
  };

  const handleToggleTrending = () => {
    if (showTrending) {
      setShowTrending(false);
    } else {
      if (trendingTickers.length > 0) {
        setShowTrending(true);
      } else {
        loadTrending();
      }
    }
  };

  const loadPreset = async (presetTickers) => {
    setIsFetchingDashboard(true);
    try {
      for (const t of presetTickers) {
        await supabase.from('watchlist').insert({ user_id: session.user.id, ticker: t });
      }
      loadWatchlist();
    } catch (e) {
      console.error(e);
      setIsFetchingDashboard(false);
    }
  };

  // Connect to Finnhub WebSocket
  useEffect(() => {
    if (!finnhubKey || !session) return;

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
        const updates = {};
        const newFlashStates = {};

        response.data.forEach(trade => {
          updates[trade.s] = trade.p;
        });

        setLivePrices(prev => {
          const nextPrices = { ...prev };
          Object.keys(updates).forEach(sym => {
            const price = updates[sym];
            const oldPrice = prev[sym];
            if (oldPrice && price !== oldPrice) {
              newFlashStates[sym] = price > oldPrice ? 'up' : 'down';
            }
            nextPrices[sym] = price;
          });
          return nextPrices;
        });

        if (Object.keys(newFlashStates).length > 0) {
          setFlashStates(f => ({ ...f, ...newFlashStates }));
          setTimeout(() => {
            setFlashStates(f => {
              const reset = { ...f };
              Object.keys(newFlashStates).forEach(sym => { reset[sym] = null; });
              return reset;
            });
          }, 500);
        }
      }
    };

    return () => {
      if (ws.readyState === 1) {
        ws.close();
      }
    };
  }, [finnhubKey, tickers, session]);

  // Mock ticking if no API key is provided
  useEffect(() => {
    if (finnhubKey || !session) return;
    const interval = setInterval(() => {
      const newFlashStates = {};

      setLivePrices(prev => {
        const newPrices = { ...prev };
        Object.keys(newPrices).forEach(sym => {
          const change = (Math.random() - 0.5) * 0.5;
          newPrices[sym] = newPrices[sym] + change;
          newFlashStates[sym] = change > 0 ? 'up' : 'down';
        });
        return newPrices;
      });

      setFlashStates(f => ({ ...f, ...newFlashStates }));
      setTimeout(() => {
        setFlashStates(f => {
          const reset = { ...f };
          Object.keys(newFlashStates).forEach(sym => { reset[sym] = null; });
          return reset;
        });
      }, 500);
    }, 2000);
    return () => clearInterval(interval);
  }, [finnhubKey, session]);

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

    await addTicker(tickerSymbol);
    setIsSearching(false);
  };

  const openDetailsModal = async (ticker) => {
    setExpandedTicker(ticker);
    setActiveTab('overview');
    setIsLoadingIntraday(true);
    setIntradayData([]);
    setEarningsData(null);

    if (true) {
      setIsLoadingEarnings(true);
      fetch(`${API_BASE_URL}/api/earnings/${ticker.ticker || ticker.symbol}`)
        .then(r => r.json())
        .then(d => setEarningsData(d))
        .catch(err => console.error("Earnings fetch err", err))
        .finally(() => setIsLoadingEarnings(false));
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/intraday/${ticker.ticker || ticker.symbol}`);
      const data = await res.json();
      setIntradayData(data.history || []);
    } catch (err) {
      console.error("Failed to fetch intraday data", err);
    } finally {
      setIsLoadingIntraday(false);
    }
  };

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({ 
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (!session) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center' }}>
        <Activity size={64} color="var(--accent)" style={{ marginBottom: '1rem' }} />
        <h1 className="title" style={{ fontSize: '2.5rem', marginBottom: '1rem', justifyContent: 'center' }}>AI Trend Predictor</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', maxWidth: '400px' }}>
          Track your personal watchlist with AI-driven insights. Get real-time probability scores and 1-day vs 5-day divergence alerts based on a proven machine learning model.
        </p>
        <button onClick={signInWithGoogle} className="btn" style={{ fontSize: '1.1rem', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', color: '#333' }}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18" alt="Google" />
          Sign in with Google
        </button>
      </div>
    );
  }

  const upCount = tickers.filter(t => t.predicted_trend === 'UP').length;
  const downCount = tickers.filter(t => t.predicted_trend === 'DOWN').length;
  const netBias = upCount > downCount ? 'Net bullish' : downCount > upCount ? 'Net bearish' : 'Mixed';
  const divergenceCount = tickers.filter(t => t.hasDivergence).length;

  let visibleTickers = tickers.filter(t => t.confidence >= minConfidence);

  if (sortOption === 'confidence') {
    visibleTickers.sort((a, b) => b.confidence - a.confidence);
  } else if (sortOption === 'alphabetical') {
    visibleTickers.sort((a, b) => a.ticker.localeCompare(b.ticker));
  } else if (sortOption === 'divergence') {
    visibleTickers.sort((a, b) => (b.hasDivergence ? 1 : 0) - (a.hasDivergence ? 1 : 0));
  }

  const hiddenCount = tickers.length - visibleTickers.length;

  return (
    <div className="container">
      <header className="header" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 className="title"><Activity color="var(--accent)" /> AI Trend Predictor</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
            <Calendar size={14} />
            <span>{currentDate}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div className="search-container" style={{ position: 'relative', marginTop: '0.5rem' }}>
            <form onSubmit={(e) => { e.preventDefault(); handlePredictTicker(searchQuery); }} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="search-input"
                placeholder="Add ticker (e.g. Apple)"
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
          <button onClick={signOut} className="btn" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      {tickers.length > 0 && (
        <div className="portfolio-summary">
          <div className="summary-item">
            <span className="summary-label">Portfolio Bias</span>
            <span className={`summary-value ${netBias === 'Net bullish' ? 'prediction-up' : netBias === 'Net bearish' ? 'prediction-down' : ''}`}>
              {netBias}
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Signals</span>
            <span className="summary-value" style={{ fontSize: '1rem' }}>
              <span style={{ color: 'var(--up-color)' }}>{upCount} UP</span> · <span style={{ color: 'var(--down-color)' }}>{downCount} DOWN</span>
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Divergences</span>
            <span className="summary-value" style={{ color: divergenceCount > 0 ? '#fbbf24' : 'var(--text-muted)' }}>
              {divergenceCount} detected
            </span>
          </div>
          <div className="summary-item" style={{ flexGrow: 1, display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <select className="search-input" value={sortOption} onChange={(e) => setSortOption(e.target.value)} style={{ padding: '0.25rem 0.5rem' }}>
              <option value="confidence">Sort by Confidence</option>
              <option value="alphabetical">Sort Alphabetical</option>
              <option value="divergence">Divergence First</option>
            </select>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.375rem', padding: '0.25rem 0.5rem' }}>
              <Filter size={14} color="var(--text-muted)" />
              <select className="search-input" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} style={{ border: 'none', background: 'transparent', padding: 0 }}>
                <option value={0}>All Confidences</option>
                <option value={55}>Min 55%</option>
                <option value={65}>Min 65%</option>
                <option value={75}>Min 75%</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Global Earnings Warning Banner */}
      {Object.values(earningsMap).some(e => e.is_warning) && (
        <div className="config-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--down-color)', color: '#fca5a5', marginBottom: '1.5rem', padding: '0.75rem' }}>
          <AlertTriangle size={20} />
          <span>
            <strong>High Volatility Warning:</strong> {Object.values(earningsMap).filter(e => e.is_warning).length} ticker(s) in your watchlist have earnings within 5 days.
          </span>
        </div>
      )}

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
        <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 0.5rem' }}></div>

        <button
          onClick={requestNotificationPermission}
          disabled={notificationsEnabled}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid var(--border-color)', color: notificationsEnabled ? 'var(--up-color)' : 'var(--text-muted)', padding: '4px 12px', borderRadius: '20px', cursor: notificationsEnabled ? 'default' : 'pointer' }}
        >
          <Zap size={16} color={notificationsEnabled ? 'var(--up-color)' : 'var(--text-muted)'} />
          {notificationsEnabled ? 'Alerts Enabled' : 'Enable Alerts'}
        </button>

        {isFetchingDashboard && <div style={{ marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--accent)' }}>Updating Watchlist...</div>}
      </div>

      <div className="dashboard">
        {tickers.length === 0 && !isFetchingDashboard && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 1rem' }}>
            <h2 style={{ color: 'var(--text-main)', marginBottom: '1rem' }}>Welcome to your Watchlist</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Add your first ticker or choose a preset to get started.</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)' }} onClick={() => loadPreset(['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN'])}>Big Tech</button>
              <button className="btn" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)' }} onClick={() => loadPreset(['TSLA', 'NIO', 'RIVN', 'LCID', 'F'])}>EV Sector</button>
              <button className="btn" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)' }} onClick={() => loadPreset(['JNJ', 'KO', 'PG', 'VZ', 'T'])}>Dividend Plays</button>
            </div>
          </div>
        )}
        {tickers.length === 0 && isFetchingDashboard && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 1rem' }}>
            <Activity size={48} color="var(--accent)" style={{ marginBottom: '1rem', animation: 'pulse 2s infinite' }} />
            <h2 style={{ color: 'var(--text-main)', marginBottom: '0.5rem' }}>Loading Watchlist...</h2>
          </div>
        )}

        {visibleTickers.map(ticker => {
          const price = livePrices[ticker.ticker] || ticker.current_price;
          const flash = flashStates[ticker.ticker];

          let pnlElement = null;
          if (ticker.entry_price && price) {
            const diff = price - ticker.entry_price;
            const pct = (diff / ticker.entry_price) * 100;
            const isProfit = diff >= 0;
            pnlElement = (
              <div style={{ fontSize: '0.875rem', color: isProfit ? 'var(--up-color)' : 'var(--down-color)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {isProfit ? '+' : ''}{diff.toFixed(2)} ({isProfit ? '+' : ''}{pct.toFixed(2)}%)
              </div>
            );
          }

          return (
            <div key={ticker.ticker} className={`card ${ticker.hasDivergence ? 'card-divergence' : ''}`} onClick={() => openDetailsModal(ticker)} style={{ cursor: 'pointer' }}>
              {ticker.hasDivergence && (
                <div className="divergence-tag">
                  <AlertTriangle size={14} /> Divergence Alert
                </div>
              )}
              {earningsMap[ticker.ticker]?.is_warning && (
                <div className="earnings-tag">
                  <Zap size={14} /> Earnings Soon
                </div>
              )}
              <div className="card-header">
                <span className="ticker-name">{ticker.ticker}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className={`prediction-badge ${ticker.predicted_trend === 'UP' ? 'prediction-up' : 'prediction-down'}`}>
                    {ticker.predicted_trend === 'UP' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span>{ticker.predicted_trend} ({ticker.confidence}%)</span>
                  </div>
                  <button className="remove-btn" onClick={(e) => { e.stopPropagation(); removeTicker(ticker.ticker, e); }} title="Remove from watchlist">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {ticker.hasDivergence && (
                <div className="divergence-subtitle">
                  1-day {ticker.trend_1d} · 5-day {ticker.trend_5d}
                </div>
              )}

              <div className={`live-price ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`} style={{ marginTop: ticker.hasDivergence ? '0.5rem' : '0' }}>
                ${price.toFixed(2)}
              </div>
              {pnlElement}

              {/* Mini sparkline history bar */}
              {ticker.history && ticker.history.length > 1 && (
                <div style={{ height: '40px', marginTop: '0.5rem' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ticker.history}>
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke={ticker.predicted_trend === 'UP' ? 'var(--up-color)' : 'var(--down-color)'}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <YAxis domain={['dataMin', 'dataMax']} hide />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Model accuracy / win rate bar */}
              {winRates[ticker.ticker] && (
                <div className="win-rate-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Model Accuracy</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: '600', color: winRates[ticker.ticker].rate >= 60 ? 'var(--up-color)' : winRates[ticker.ticker].rate >= 45 ? '#fbbf24' : 'var(--down-color)' }}>
                      {winRates[ticker.ticker].rate}% ({winRates[ticker.ticker].total} predictions)
                    </span>
                  </div>
                  <div className="progress-bg">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${winRates[ticker.ticker].rate}%`,
                        background: winRates[ticker.ticker].rate >= 60 ? 'var(--up-color)' : winRates[ticker.ticker].rate >= 45 ? '#fbbf24' : 'var(--down-color)',
                        transition: 'width 0.5s ease'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '-1rem', marginBottom: '2rem' }}>
          {hiddenCount} ticker{hiddenCount !== 1 ? 's' : ''} hidden by confidence filter.
        </div>
      )}

      {/* Discover Trending Section */}
      <div style={{ marginTop: '3rem', borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--text-main)' }}>Discover Trending Opportunities</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {showTrending && (
              <button className="btn" onClick={loadTrending} disabled={isFetchingTrending} style={{ padding: '8px 16px', fontSize: '0.875rem', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                Refresh
              </button>
            )}
            <button className="btn" onClick={handleToggleTrending} disabled={isFetchingTrending} style={{ padding: '8px 16px', fontSize: '0.875rem' }}>
              {isFetchingTrending ? 'Loading...' : (showTrending ? 'Hide Trending' : 'Load Scraped Tickers')}
            </button>
          </div>
        </div>

        {showTrending && (
          <div className="dashboard">
            {isFetchingTrending && trendingTickers.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem' }}>
                <Activity size={32} color="var(--accent)" style={{ marginBottom: '1rem', animation: 'pulse 2s infinite' }} />
                <p style={{ color: 'var(--text-muted)' }}>Scraping Yahoo Finance...</p>
              </div>
            ) : (
              <div className="dashboard">
                {trendingTickers.map((t) => (
                  <div key={t.ticker} className="card" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => openDetailsModal(t)}>
                    <div className="card-header">
                      <span className="ticker-name">{t.ticker}</span>
                      <div className={`prediction-badge ${t.predicted_trend === 'UP' ? 'prediction-up' : 'prediction-down'}`}>
                        {t.predicted_trend === 'UP' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                        <span>{t.predicted_trend} ({t.confidence}%)</span>
                      </div>
                    </div>
                    <div className="divergence-subtitle" style={{ marginBottom: '0.5rem' }}>
                      {horizon} Prediction
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.5rem' }}>
                      <span className="live-price">${(livePrices[t.ticker] || t.current_price).toFixed(2)}</span>
                      <button
                        className="btn"
                        onClick={(e) => { e.stopPropagation(); handleAddTrending(t.ticker, e); }}
                        style={{ padding: '4px 8px', fontSize: '0.875rem' }}
                      >
                        <Plus size={16} style={{ marginRight: '4px' }} /> Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {expandedTicker && (
        <div className="modal-overlay" onClick={() => setExpandedTicker(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setExpandedTicker(null)}>
              <X size={24} />
            </button>
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
                {expandedTicker.ticker} Overview
              </h2>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <div className={`prediction-badge ${expandedTicker.predicted_trend === 'UP' ? 'prediction-up' : 'prediction-down'}`} style={{ fontSize: '1rem', padding: '6px 12px' }}>
                  {expandedTicker.predicted_trend === 'UP' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                  <span>{expandedTicker.predicted_trend} ({expandedTicker.confidence}%)</span>
                </div>
                <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '6px 12px', background: 'var(--bg-color)', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                  Active Horizon: {horizon}
                </div>
                {winRates[expandedTicker.ticker] && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '6px 12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '20px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    <Activity size={14} color="var(--accent)" />
                    <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--accent)' }}>
                      Trust: {winRates[expandedTicker.ticker].rate}%
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-tabs">
              <button
                className={`modal-tab ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Overview & Position
              </button>
              <button
                className={`modal-tab ${activeTab === 'intelligence' ? 'active' : ''}`}
                onClick={() => setActiveTab('intelligence')}
              >
                Signals & Earnings
              </button>
            </div>

            {activeTab === 'overview' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  {/* Portfolio Position Tracking */}
                  <div style={{ padding: '1rem', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>My Position</h3>
                        {expandedTicker.entry_price ? (
                          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
                            <div>
                              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Avg Cost</p>
                              <p style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>${expandedTicker.entry_price.toFixed(2)}</p>
                            </div>
                            {expandedTicker.entry_date && (
                              <div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Date</p>
                                <p style={{ fontSize: '0.875rem' }}>{new Date(expandedTicker.entry_date).toLocaleDateString()}</p>
                              </div>
                            )}
                            {livePrices[expandedTicker.ticker] && (
                              <div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>P&L</p>
                                <p style={{ fontSize: '1.125rem', fontWeight: 'bold', color: livePrices[expandedTicker.ticker] >= expandedTicker.entry_price ? 'var(--up-color)' : 'var(--down-color)' }}>
                                  {(livePrices[expandedTicker.ticker] - expandedTicker.entry_price) >= 0 ? '+' : ''}
                                  ${(livePrices[expandedTicker.ticker] - expandedTicker.entry_price).toFixed(2)}
                                  <span style={{ fontSize: '0.875rem', marginLeft: '0.25rem' }}>
                                    ({(((livePrices[expandedTicker.ticker] - expandedTicker.entry_price) / expandedTicker.entry_price) * 100).toFixed(2)}%)
                                  </span>
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>Not tracking a position. Enter your buy details.</p>
                        )}
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          savePosition(expandedTicker.ticker, e.target.elements.price.value, e.target.elements.date.value);
                        }}
                        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--card-bg)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', width: '100%' }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Buy Price ($)</label>
                          <input name="price" type="number" step="0.01" defaultValue={expandedTicker.entry_price || ''} className="search-input" style={{ width: '100px', padding: '0.375rem 0.5rem', background: 'var(--bg-color)' }} placeholder="0.00" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Date</label>
                          <input name="date" type="date" defaultValue={expandedTicker.entry_date || ''} className="search-input" style={{ width: '140px', padding: '0.375rem 0.5rem', background: 'var(--bg-color)' }} />
                        </div>
                        <button type="submit" className="btn" style={{ padding: '0.375rem 0.75rem', height: 'max-content' }}>Save</button>
                        {expandedTicker.entry_price && (
                          <button type="button" onClick={() => savePosition(expandedTicker.ticker, null, null)} className="btn" style={{ padding: '0.375rem 0.75rem', height: 'max-content', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Clear</button>
                        )}
                      </form>
                    </div>
                  </div>

                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                  <div style={{ height: '300px' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>30-Day Price History</h3>
                    {expandedTicker.history && expandedTicker.history.length > 0 ? (
                      <ResponsiveContainer width="100%" height="90%">
                        <LineChart data={[...expandedTicker.history, { date: new Date().toISOString(), price: livePrices[expandedTicker.ticker] || expandedTicker.current_price }]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                          <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickFormatter={(str) => { const date = new Date(str); return `${date.getMonth() + 1}/${date.getDate()}`; }} />
                          <YAxis domain={['auto', 'auto']} stroke="var(--text-muted)" fontSize={12} tickFormatter={(val) => `$${val}`} width={60} />
                          <Tooltip
                            contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                            itemStyle={{ color: 'var(--text-main)' }}
                            labelFormatter={(label) => new Date(label).toLocaleDateString()}
                          />
                          <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                        No historical data available
                      </div>
                    )}
                  </div>

                  <div style={{ flex: '1 1 300px', height: '100%' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>Intraday (5-min)</h3>
                    {isLoadingIntraday ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '90%', color: 'var(--text-muted)' }}>Loading intraday data...</div>
                    ) : intradayData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="90%">
                        <LineChart data={intradayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={12} />
                          <YAxis domain={['auto', 'auto']} stroke="var(--text-muted)" fontSize={12} tickFormatter={(val) => `$${val}`} width={60} />
                          <Tooltip contentStyle={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-main)' }} />
                          <Line type="stepAfter" dataKey="price" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '90%', color: 'var(--text-muted)' }}>No intraday data available</div>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'intelligence' && (
              <div className="modal-grid">
                {expandedTicker.signals && (
                  <div style={{ padding: '1rem', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>Signal Confluence Breakdown</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {Object.keys(expandedTicker.signals).map(key => {
                        const sig = expandedTicker.signals[key];
                        const info = laymanExplanations[key] || { name: key, desc: "" };
                        return (
                          <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '6px' }}>
                            <div className={`prediction-badge ${sig.direction === 'UP' ? 'prediction-up' : sig.direction === 'DOWN' ? 'prediction-down' : ''}`} style={{ padding: '4px 8px', minWidth: '70px', justifyContent: 'center' }}>
                              {sig.direction === 'UP' ? <TrendingUp size={14} /> : sig.direction === 'DOWN' ? <TrendingDown size={14} /> : '-'} {sig.direction}
                            </div>
                            <div>
                              <p style={{ fontSize: '0.875rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '0.25rem' }}>{info.name} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.75rem', marginLeft: '0.5rem' }}>Value: {sig.value}</span></p>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{info.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ padding: '1rem', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>Earnings Intelligence</h3>
                  {isLoadingEarnings ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading earnings data...</p>
                  ) : earningsData && !earningsData.error ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {earningsData.next_earnings_date ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '6px' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Next Earnings:</span>
                          <span style={{ color: earningsData.is_warning ? 'var(--down-color)' : 'var(--text-main)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {earningsData.is_warning && <AlertTriangle size={14} />}
                            {earningsData.next_earnings_date} ({earningsData.days_until} days)
                          </span>
                        </div>
                      ) : (
                        <div style={{ padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '6px' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Next earnings date not available</span>
                        </div>
                      )}
                      {earningsData.analyst && earningsData.analyst.consensus !== 'UNKNOWN' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '6px' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Analyst Consensus:</span>
                          <span style={{ color: earningsData.analyst.consensus === 'BUY' ? 'var(--up-color)' : earningsData.analyst.consensus === 'SELL' ? 'var(--down-color)' : 'var(--text-main)', fontWeight: 'bold' }}>
                            {earningsData.analyst.consensus}
                          </span>
                        </div>
                      )}
                      {earningsData.historical_beats && earningsData.historical_beats.beat_rate != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--card-bg)', borderRadius: '6px' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Earnings Beat Rate:</span>
                          <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>
                            {Math.round(earningsData.historical_beats.beat_rate * 100)}% (Last {earningsData.historical_beats.quarters_checked} Qs)
                          </span>
                        </div>
                      )}
                      {!earningsData.next_earnings_date && (!earningsData.analyst || earningsData.analyst.consensus === 'UNKNOWN') && (!earningsData.historical_beats || earningsData.historical_beats.beat_rate == null) && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No earnings data available for this ticker.</p>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Earnings data unavailable. The backend may still be deploying.</p>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

export default App;
