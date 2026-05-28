import { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Activity, Search, X, Calendar, HelpCircle, Settings, LogOut, Trash2, Filter, Plus, Zap } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid } from 'recharts';
import { supabase } from './supabaseClient';
import './index.css';

import Header from './components/Header';
import TrendCard from './components/TrendCard';
import TrendingSection from './components/TrendingSection';
import DetailsModal from './components/modals/DetailsModal';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://sp500-predictor-697399258111.us-central1.run.app';

const getAuthHeaders = (session) => {
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
};

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
  const [horizon, setHorizon] = useState(() => localStorage.getItem('sp500_horizon') || '1d');
  const [useMacro, setUseMacro] = useState(() => localStorage.getItem('sp500_useMacro') === 'true');

  useEffect(() => {
    localStorage.setItem('sp500_horizon', horizon);
  }, [horizon]);

  useEffect(() => {
    localStorage.setItem('sp500_useMacro', String(useMacro));
  }, [useMacro]);
  const [isFetchingDashboard, setIsFetchingDashboard] = useState(false);
  const [minConfidence, setMinConfidence] = useState(0);
  const [earningsMap, setEarningsMap] = useState({});
  const [isFetchingEarningsBatch, setIsFetchingEarningsBatch] = useState(false);
  const [sortOption, setSortOption] = useState('confidence'); // 'confidence', 'alphabetical', 'divergence'
  const [winRates, setWinRates] = useState({});
  const [trendingTickers, setTrendingTickers] = useState([]);
  const [isFetchingTrending, setIsFetchingTrending] = useState(false);
  const [showTrending, setShowTrending] = useState(false);
  // expandedCards state removed
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
      // Dedup: only log one prediction per ticker/horizon per 12 hours
      const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from('predictions')
        .select('id')
        .eq('user_id', session.user.id)
        .eq('ticker', ticker)
        .eq('horizon', horizonStr)
        .gte('created_at', cutoff)
        .limit(1);

      if (existing && existing.length > 0) return;

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
        .select('ticker, horizon, confidence, created_at, resolved_correctly')
        .eq('user_id', session.user.id)
        .not('resolved_correctly', 'is', null);

      if (error) throw error;

      const rates = {};
      const now = new Date();
      
      data.forEach(p => {
        if (!rates[p.ticker]) {
          rates[p.ticker] = {
            overall: { wins: 0, total: 0 },
            '1d': { wins: 0, total: 0 },
            '5d': { wins: 0, total: 0 },
            rolling30d: { wins: 0, total: 0 },
            buckets: {
              '50-60%': { wins: 0, total: 0 },
              '60-70%': { wins: 0, total: 0 },
              '70-80%': { wins: 0, total: 0 },
              '80%+': { wins: 0, total: 0 }
            }
          };
        }
        
        const r = rates[p.ticker];
        const isWin = p.resolved_correctly ? 1 : 0;
        
        // Overall
        r.overall.total += 1;
        r.overall.wins += isWin;
        
        // Horizon
        if (p.horizon === '1d') {
          r['1d'].total += 1;
          r['1d'].wins += isWin;
        } else if (p.horizon === '5d') {
          r['5d'].total += 1;
          r['5d'].wins += isWin;
        }
        
        // Rolling 30d
        const createdDate = new Date(p.created_at);
        const diffDays = (now - createdDate) / (1000 * 3600 * 24);
        if (diffDays <= 30) {
          r.rolling30d.total += 1;
          r.rolling30d.wins += isWin;
        }
        
        // Buckets
        const conf = p.confidence * 100;
        let bucket = '50-60%';
        if (conf >= 80) bucket = '80%+';
        else if (conf >= 70) bucket = '70-80%';
        else if (conf >= 60) bucket = '60-70%';
        
        r.buckets[bucket].total += 1;
        r.buckets[bucket].wins += isWin;
      });

      const formatted = {};
      Object.keys(rates).forEach(t => {
        const r = rates[t];
        const calcRate = (wins, total) => total > 0 ? Math.round((wins / total) * 100) : null;
        
        formatted[t] = {
          overall: { rate: calcRate(r.overall.wins, r.overall.total), total: r.overall.total },
          '1d': { rate: calcRate(r['1d'].wins, r['1d'].total), total: r['1d'].total },
          '5d': { rate: calcRate(r['5d'].wins, r['5d'].total), total: r['5d'].total },
          rolling30d: { rate: calcRate(r.rolling30d.wins, r.rolling30d.total), total: r.rolling30d.total },
          buckets: {}
        };
        
        Object.keys(r.buckets).forEach(b => {
          formatted[t].buckets[b] = {
            rate: calcRate(r.buckets[b].wins, r.buckets[b].total),
            total: r.buckets[b].total
          };
        });
      });

      setWinRates(formatted);
    } catch (e) {
      console.error("Failed to load win rates", e);
    }
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
        method: 'POST', headers: getAuthHeaders(session),
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
      // Slow path: fetch the other horizon in the background for divergence detection
      // Slow path: fetch the other horizon in the background for divergence detection
      const otherHorizon = horizon === '1d' ? '5d' : '1d';
      fetch(`${API_BASE_URL}/api/predict_batch`, {
        method: 'POST', headers: getAuthHeaders(session),
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
      const res = await fetch(`${API_BASE_URL}/api/trending?horizon=${horizon}&macro=${useMacro ? 'true' : 'false'}`, {
        headers: getAuthHeaders(session)
      });
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
        const res = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(val)}`, {
          headers: getAuthHeaders(session)
        });
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

    setIsLoadingEarnings(true);
    fetch(`${API_BASE_URL}/api/earnings/${ticker.ticker || ticker.symbol}`, {
      headers: getAuthHeaders(session)
    })
      .then(r => r.json())
      .then(d => setEarningsData(d))
      .catch(err => console.error("Earnings fetch err", err))
      .finally(() => setIsLoadingEarnings(false));

    try {
      const res = await fetch(`${API_BASE_URL}/api/intraday/${ticker.ticker || ticker.symbol}`, {
        headers: getAuthHeaders(session)
      });
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
      <Header
        currentDate={currentDate}
        searchQuery={searchQuery}
        handleSearchChange={handleSearchChange}
        handlePredictTicker={handlePredictTicker}
        isSearching={isSearching}
        suggestions={suggestions}
        signOut={signOut}
      />

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

      {Object.values(earningsMap).some(e => e?.is_warning) && (
        <div className="config-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--down-color)', color: '#fca5a5', marginBottom: '1.5rem', padding: '0.75rem' }}>
          <AlertTriangle size={20} />
          <span>
            <strong>High Volatility Warning:</strong> {Object.values(earningsMap).filter(e => e?.is_warning).length} ticker(s) in your watchlist have earnings within 5 days.
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
          const fullWinRate = winRates[ticker.ticker];
          // Use horizon specific rate if available, otherwise fallback to overall
          const displayWinRate = fullWinRate ? (fullWinRate[horizon].total > 0 ? fullWinRate[horizon] : fullWinRate.overall) : null;
          
          return (
            <TrendCard
              key={ticker.ticker}
              ticker={ticker}
              price={livePrices[ticker.ticker] || ticker.current_price}
              flash={flashStates[ticker.ticker]}
              earningsInfo={earningsMap[ticker.ticker]}
              winRateInfo={displayWinRate}
              fullWinRateInfo={fullWinRate} // pass full info so DetailsModal can use it
              openDetailsModal={() => {
                // Pass fullWinRate to DetailsModal
                const t = { ...ticker, fullWinRate };
                openDetailsModal(t);
              }}
              removeTicker={removeTicker}
            />
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '-1rem', marginBottom: '2rem' }}>
          {hiddenCount} ticker{hiddenCount !== 1 ? 's' : ''} hidden by confidence filter.
        </div>
      )}

      <TrendingSection
        showTrending={showTrending}
        loadTrending={loadTrending}
        handleToggleTrending={handleToggleTrending}
        isFetchingTrending={isFetchingTrending}
        trendingTickers={trendingTickers}
        livePrices={livePrices}
        horizon={horizon}
        openDetailsModal={openDetailsModal}
        handleAddTrending={handleAddTrending}
      />

      <DetailsModal
        expandedTicker={expandedTicker}
        setExpandedTicker={setExpandedTicker}
        horizon={horizon}
        winRates={winRates}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        livePrices={livePrices}
        savePosition={savePosition}
        isLoadingIntraday={isLoadingIntraday}
        intradayData={intradayData}
        isLoadingEarnings={isLoadingEarnings}
        earningsData={earningsData}
        laymanExplanations={laymanExplanations}
      />
    </div>
  );
}

export default App;
