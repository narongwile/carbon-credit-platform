'use client'

const APIS = [
  { name: 'REST API v2', status: 'active', endpoint: 'https://api.eternity.io/v2', calls: '2.3M/day' },
  { name: 'WebSocket Stream', status: 'active', endpoint: 'wss://stream.eternity.io', calls: '4.1K conn' },
  { name: 'MQTT Broker', status: 'active', endpoint: 'mqtt://iot.eternity.io:1883', calls: '12K devices' },
  { name: 'Webhook Notifications', status: 'degraded', endpoint: 'https://hooks.eternity.io', calls: '45K/day' },
]

export default function IntegrationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">API & Integrations</h1>
        <p className="text-sm text-slate-500 mt-1">Manage platform APIs and third-party integrations</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {APIS.map((api) => (
          <div key={api.name} className="rounded-xl p-5" style={{ background: '#0d1117', border: '1px solid #1e2433' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">{api.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${api.status === 'active' ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'}`}>
                {api.status}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500 mb-2">{api.endpoint}</div>
            <div className="text-xs text-slate-400">Traffic: <span className="text-white">{api.calls}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
