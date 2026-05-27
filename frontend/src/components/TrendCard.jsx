import { TrendingUp, TrendingDown, AlertTriangle, Zap, Trash2 } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

export default function TrendCard({ 
  ticker, 
  price, 
  flash, 
  earningsInfo, 
  winRateInfo, 
  openDetailsModal, 
  removeTicker 
}) {
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
    <div className={`card ${ticker.hasDivergence ? 'card-divergence' : ''}`} onClick={() => openDetailsModal(ticker)} style={{ cursor: 'pointer' }}>
      {ticker.hasDivergence && (
        <div className="divergence-tag">
          <AlertTriangle size={14} /> Divergence Alert
        </div>
      )}
      {earningsInfo?.is_warning && (
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
      {winRateInfo && (
        <div className="win-rate-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Model Accuracy</span>
            <span style={{ fontSize: '0.75rem', fontWeight: '600', color: winRateInfo.rate >= 60 ? 'var(--up-color)' : winRateInfo.rate >= 45 ? '#fbbf24' : 'var(--down-color)' }}>
              {winRateInfo.rate}% ({winRateInfo.total} predictions)
            </span>
          </div>
          <div className="progress-bg">
            <div
              className="progress-bar"
              style={{
                width: `${winRateInfo.rate}%`,
                background: winRateInfo.rate >= 60 ? 'var(--up-color)' : winRateInfo.rate >= 45 ? '#fbbf24' : 'var(--down-color)',
                transition: 'width 0.5s ease'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
