import { X, TrendingUp, TrendingDown, Activity, AlertTriangle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid } from 'recharts';
import IntradayChart from '../charts/IntradayChart';

export default function DetailsModal({
  expandedTicker,
  setExpandedTicker,
  horizon,
  winRates,
  activeTab,
  setActiveTab,
  livePrices,
  savePosition,
  isLoadingIntraday,
  intradayData,
  isLoadingEarnings,
  earningsData,
  laymanExplanations
}) {
  if (!expandedTicker) return null;

  return (
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
          <button
            className={`modal-tab ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            Accuracy Analytics
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

              <IntradayChart intradayData={intradayData} isLoadingIntraday={isLoadingIntraday} />
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
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Could not load earnings data</p>
              )}
            </div>
          </div>
        )}
        {activeTab === 'analytics' && (
          <div className="modal-grid">
            <div style={{ padding: '1.5rem', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)', gridColumn: '1 / -1' }}>
              <h3 style={{ fontSize: '1.25rem', color: 'var(--text-main)', marginBottom: '1.5rem' }}>Predictive Accuracy Breakdown</h3>
              
              {!expandedTicker.fullWinRate ? (
                <p style={{ color: 'var(--text-muted)' }}>Not enough resolved predictions to show analytics.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
                  
                  {/* Horizon Split */}
                  <div>
                    <h4 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>By Horizon</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '6px' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>1-Day Accuracy</p>
                        <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: expandedTicker.fullWinRate['1d'].rate >= 55 ? 'var(--up-color)' : 'var(--text-main)' }}>
                          {expandedTicker.fullWinRate['1d'].rate !== null ? `${expandedTicker.fullWinRate['1d'].rate}%` : 'N/A'}
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{expandedTicker.fullWinRate['1d'].total} predictions</p>
                      </div>
                      <div style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '6px' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>5-Day Accuracy</p>
                        <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: expandedTicker.fullWinRate['5d'].rate >= 55 ? 'var(--up-color)' : 'var(--text-main)' }}>
                          {expandedTicker.fullWinRate['5d'].rate !== null ? `${expandedTicker.fullWinRate['5d'].rate}%` : 'N/A'}
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{expandedTicker.fullWinRate['5d'].total} predictions</p>
                      </div>
                    </div>
                  </div>

                  {/* Drift and Overall */}
                  <div>
                    <h4 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>Model Health</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '6px' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>All-Time Overall</p>
                        <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: expandedTicker.fullWinRate.overall.rate >= 55 ? 'var(--up-color)' : 'var(--text-main)' }}>
                          {expandedTicker.fullWinRate.overall.rate !== null ? `${expandedTicker.fullWinRate.overall.rate}%` : 'N/A'}
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{expandedTicker.fullWinRate.overall.total} predictions</p>
                      </div>
                      <div style={{ background: 'var(--card-bg)', padding: '1rem', borderRadius: '6px', border: expandedTicker.fullWinRate.rolling30d.rate !== null && expandedTicker.fullWinRate.overall.rate !== null && (expandedTicker.fullWinRate.overall.rate - expandedTicker.fullWinRate.rolling30d.rate >= 10) ? '1px solid var(--down-color)' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>30-Day Rolling</p>
                            <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                              {expandedTicker.fullWinRate.rolling30d.rate !== null ? `${expandedTicker.fullWinRate.rolling30d.rate}%` : 'N/A'}
                            </p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{expandedTicker.fullWinRate.rolling30d.total} predictions</p>
                          </div>
                          {expandedTicker.fullWinRate.rolling30d.rate !== null && expandedTicker.fullWinRate.overall.rate !== null && (expandedTicker.fullWinRate.overall.rate - expandedTicker.fullWinRate.rolling30d.rate >= 10) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--down-color)', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: '12px' }}>
                              <AlertTriangle size={12} /> Model Drift
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Confidence Buckets */}
                  <div style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
                    <h4 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>Accuracy by Confidence Bucket</h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '0.5rem' }}>Confidence</th>
                            <th style={{ padding: '0.5rem' }}>Win Rate</th>
                            <th style={{ padding: '0.5rem' }}>Sample Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {['50-60%', '60-70%', '70-80%', '80%+'].map(bucket => {
                            const bData = expandedTicker.fullWinRate.buckets[bucket];
                            return (
                              <tr key={bucket} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold' }}>{bucket}</td>
                                <td style={{ padding: '0.75rem 0.5rem', color: bData.rate >= 60 ? 'var(--up-color)' : 'var(--text-main)' }}>
                                  {bData.rate !== null ? `${bData.rate}%` : '-'}
                                </td>
                                <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>{bData.total}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
