export default function QuizerLoading() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a1c23', padding: '40px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 28, width: 160, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 8, marginBottom: 20, animation: 'pulse 1.5s ease-in-out infinite' }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 100, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  )
}
