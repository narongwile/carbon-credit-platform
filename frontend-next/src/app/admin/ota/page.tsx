'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Server, Download, Trash2, ArrowRightCircle, Plus, Terminal } from 'lucide-react'
import toast from 'react-hot-toast'

const surface = { background: '#0d1117', border: '1px solid #1e2433' }
const inset = { background: '#0a0e1a', border: '1px solid #1e2433' }
const gradient = { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }

interface Release { id: string; version: string; target_hw: string; artefact_uri: string; released_at: string; release_notes: string }
interface Deployment { node_id: string; release_id: string; status: string; updated_at: string }

export default function OTAManagementPage() {
  const [releases, setReleases] = useState<Release[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ version: '', target_hw: '', artefact_uri: '', release_notes: '' })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deployConfirm, setDeployConfirm] = useState<{ id: string, hw: string } | null>(null)

  const load = async () => {
    setLoading(true)
    const [rels, deps] = await Promise.all([api.otaReleases(), api.otaDeployments()])
    if (rels) setReleases(rels)
    if (deps) setDeployments(deps)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.version || !form.target_hw || !form.artefact_uri) return toast.error('Fill all required fields')
    const res = await api.saveOtaRelease(form)
    if (res?.id) {
      toast.success('Release created')
      setShowForm(false)
      setForm({ version: '', target_hw: '', artefact_uri: '', release_notes: '' })
      load()
    } else toast.error('Failed to create')
  }

  const handleDelete = async (id: string) => {
    await api.deleteOtaRelease(id)
    toast.success('Deleted')
    setDeleteConfirm(null)
    load()
  }

  const handleDeploy = async (release_id: string, target_hw: string) => {
    const res = await api.deployFleetOta({ release_id, target_hw })
    setDeployConfirm(null)
    if (res?.applied !== undefined) {
      toast.success(`Deployment initiated for ${res.applied} devices`)
      load()
    } else toast.error('Failed to deploy')
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">OTA Firmware Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage and deploy firmware updates across the fleet</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90" style={gradient}>
          <Plus size={16} /> New Release
        </button>
      </div>

      {showForm && (
        <div className="p-5 rounded-xl space-y-4" style={surface}>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Server size={14} className="text-indigo-400" /> Upload Release</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Version (e.g. v1.2.0)</label>
              <input value={form.version} onChange={e => setForm({...form, version: e.target.value})} className="w-full bg-transparent border border-slate-700 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" placeholder="v1.0.0" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Hardware</label>
              <input value={form.target_hw} onChange={e => setForm({...form, target_hw: e.target.value})} className="w-full bg-transparent border border-slate-700 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" placeholder="esp32-c3" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Artefact URI</label>
              <input value={form.artefact_uri} onChange={e => setForm({...form, artefact_uri: e.target.value})} className="w-full bg-transparent border border-slate-700 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500" placeholder="https://..." />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Release Notes</label>
            <textarea value={form.release_notes} onChange={e => setForm({...form, release_notes: e.target.value})} className="w-full bg-transparent border border-slate-700 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" rows={2} />
          </div>
          <button onClick={handleCreate} className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90" style={gradient}>Save Release</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Download size={14} className="text-green-400" /> Firmware Releases</h2>
          {releases.length === 0 ? <p className="text-sm text-slate-500 p-4 rounded-xl text-center" style={surface}>No releases found</p> : (
            releases.map(r => (
              <div key={r.id} className="p-4 rounded-xl" style={surface}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white bg-indigo-500/20 px-2 py-1 rounded text-indigo-300">{r.version}</span>
                    <span className="text-xs text-slate-400">{r.target_hw}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDeployConfirm({ id: r.id, hw: r.target_hw })} className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-400/10 px-3 py-1.5 rounded-md transition-colors"><ArrowRightCircle size={14}/> Deploy to Fleet</button>
                    <button onClick={() => setDeleteConfirm(r.id)} className="text-red-400 hover:text-red-300 p-1.5 rounded-md hover:bg-red-400/10 transition-colors"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="text-xs text-slate-500 font-mono mb-2 truncate">{r.artefact_uri}</div>
                {r.release_notes && <div className="text-sm text-slate-300 bg-black/20 p-3 rounded-lg border border-slate-800">{r.release_notes}</div>}
              </div>
            ))
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Terminal size={14} className="text-amber-400" /> Active Deployments</h2>
          <div className="rounded-xl overflow-hidden" style={surface}>
            {deployments.length === 0 ? <p className="text-sm text-slate-500 p-4 text-center">No active deployments</p> : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={inset} className="text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">Node</th>
                    <th className="px-3 py-2 font-medium">Release</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d, i) => {
                    const release = releases.find(r => r.id === d.release_id)
                    return (
                      <tr key={i} className="border-t border-slate-800">
                        <td className="px-3 py-2.5 text-slate-300 text-xs font-mono">{d.node_id.slice(0, 8)}...</td>
                        <td className="px-3 py-2.5 text-indigo-400 text-xs">{release?.version || d.release_id.slice(0,8)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${d.status === 'success' ? 'bg-green-500/20 text-green-400' : d.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Delete Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Delete Release?</h3>
            <p className="text-sm text-slate-400">This action cannot be undone. Are you sure you want to delete this release?</p>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm text-white bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Modal */}
      {deployConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[#0d1117] border border-[#1e2433] rounded-xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Server size={18} className="text-indigo-400" /> Deploy to Fleet</h3>
            <p className="text-sm text-slate-400">Are you sure you want to deploy this release to all <strong className="text-white">{deployConfirm.hw}</strong> devices?</p>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setDeployConfirm(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={() => handleDeploy(deployConfirm.id, deployConfirm.hw)} className="px-4 py-2 text-sm text-white rounded-lg transition-colors" style={gradient}>Deploy Now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
