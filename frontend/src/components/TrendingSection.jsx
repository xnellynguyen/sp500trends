import { Activity, TrendingUp, TrendingDown, Plus } from 'lucide-react';

export default function TrendingSection({ 
  showTrending, 
  loadTrending, 
  handleToggleTrending, 
  isFetchingTrending, 
  trendingTickers, 
  livePrices, 
  horizon, 
  openDetailsModal, 
  handleAddTrending 
}) {
  return (
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
  );
}
