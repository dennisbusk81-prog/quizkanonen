export default function RootLoading() {
  return (
    <div style={{ minHeight: '100vh', background: '#1a1c23', padding: '40px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ height: 120, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: 280, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ height: 160, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, animation: 'pulse 1.5s ease-in-out infinite' }} />
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
