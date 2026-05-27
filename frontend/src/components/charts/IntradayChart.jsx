import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid } from 'recharts';

export default function IntradayChart({ intradayData, isLoadingIntraday }) {
  return (
    <div style={{ flex: '1 1 300px', height: '100%' }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>Intraday (5-min)</h3>
      {isLoadingIntraday ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '90%', color: 'var(--text-muted)' }}>Loading intraday data...</div>
      ) : intradayData && intradayData.length > 0 ? (
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
  );
}
