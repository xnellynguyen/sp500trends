import { Calendar, Search, LogOut, Activity } from 'lucide-react';

export default function Header({ 
  currentDate, 
  searchQuery, 
  handleSearchChange, 
  handlePredictTicker, 
  isSearching, 
  suggestions, 
  signOut 
}) {
  return (
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

          {suggestions && suggestions.length > 0 && (
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
  );
}
