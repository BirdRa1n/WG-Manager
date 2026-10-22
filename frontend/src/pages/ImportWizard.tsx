import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, Eraser, Loader2 } from 'lucide-react'
import { api, Guest, LegacyItem, VPS } from '../api/client'
import { applyToast, Badge, Button, Callout, Drawer, Empty, protoLabel, Switch, useConfirm, useToast } from '../ui'
import { guestFor, RulePath } from './Forwards'

interface Row extends LegacyItem { selected: boolean; enabled: boolean; description: string; ip: string }

const STATUS: Record<LegacyItem['status'], { tone: string; label: string; help: string }> = {
  complete: { tone: 'success', label: 'completa', help: 'VPS e host configurados' },
  vps_only: { tone: 'warn', label: 'só na VPS', help: 'Aponta para o host, mas o host não tem a regra — informe o destino' },
  host_only: { tone: 'warn', label: 'só no host', help: 'A VPS não encaminha esta porta hoje — importar vai expô-la publicamente' },
}

export default function ImportWizard({ vpsList, guests, onClose, onDone }: { vpsList: VPS[]; guests: Guest[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [vpsId, setVpsId] = useState<number | undefined>(vpsList.find(v => v.gw_ip)?.id ?? vpsList[0]?.id)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [meta, setMeta] = useState<{ gw_ip: string | null; host_available: boolean; host_error?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'import' | 'clean' | null>(null)
  const [imported, setImported] = useState<Row[]>([])
  const vps = vpsList.find(v => v.id === vpsId)

  function load() {
    if (!vpsId) return
    setRows(null); setError(null); setImported([])
    api.legacy(vpsId).then(r => {
      setMeta(r)
      setRows(r.items.map(it => {
        const g = guestFor(it.target_ip, guests)
        const safe = it.status === 'complete' && !it.port_in_use
        return { ...it, ip: it.target_ip ?? '', description: g ? g.name : '', selected: !it.exists && it.status !== 'host_only', enabled: safe }
      }))
    }).catch(e => setError(e.message))
  }
  useEffect(load, [vpsId])

  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const chosen = useMemo(() => (rows ?? []).filter(r => r.selected && !r.exists), [rows])
  const invalid = chosen.filter(r => !/^\d+\.\d+\.\d+\.\d+$/.test(r.ip))

  async function doImport() {
    if (!vpsId || !chosen.length) return
    const exposing = chosen.filter(r => r.enabled && (r.status === 'host_only' || r.port_in_use))
    if (exposing.length && !(await confirm({
      title: 'Expor portas novas?', confirm: 'Importar mesmo assim',
      body: <>As portas <b>{exposing.map(r => r.port).join(', ')}</b> serão abertas na VPS agora (hoje elas não estão expostas ou conflitam com um serviço local). Prefira importá-las desativadas e ativar depois.</>,
    }))) return
    setBusy('import')
    try {
      const res = await api.importLegacy(vpsId, chosen.map(r => ({
        port: r.port, protocol: r.protocol, mode: r.mode, target_ip: r.ip, target_port: r.target_port,
        description: r.description, enabled: r.enabled,
      })))
      applyToast(toast, res.apply, `${res.imported} regra(s) importada(s)`)
      setImported(chosen)
      onDone()
      setRows(rs => rs!.map(r => (chosen.includes(r) ? { ...r, exists: true, selected: false } : r)))
    } catch (e: any) { toast('error', 'Importação falhou', e.message) }
    setBusy(null)
  }

  async function cleanup() {
    if (!vpsId) return
    const vps_spec = imported.flatMap(r => r.vps_spec)
    const host_spec = imported.flatMap(r => r.host_spec)
    const ok = await confirm({
      title: 'Limpar regras antigas do fw-manager?', danger: true, confirm: `Remover ${vps_spec.length + host_spec.length} linha(s)`,
      body: <>
        As regras equivalentes já estão ativas nas cadeias <code>WGM-*</code>, então o tráfego não para. Serão removidas apenas as linhas
        legadas dessas {imported.length} porta(s) ({vps_spec.length} na VPS, {host_spec.length} no host). O script <code>fw-manager</code> em si não é apagado.
        Um backup do <code>rules.v4</code> original fica em <code>/etc/iptables/rules.v4.wgm-original</code>.
      </>,
    })
    if (!ok) return
    setBusy('clean')
    try {
      const r = await api.cleanupLegacy(vpsId, { vps_spec, host_spec })
      toast('success', 'Regras antigas removidas', `${r.removed_vps} na VPS · ${r.removed_host} no host`)
      setImported([])
      load()
    } catch (e: any) { toast('error', 'Falha na limpeza', e.message) }
    setBusy(null)
  }

  return (
    <Drawer open wide onClose={onClose} title="Importar do fw-manager"
      sub="Lê as regras DNAT existentes na VPS e no host, junta os dois saltos e cria encaminhamentos equivalentes."
      footer={<>
        <Button onClick={onClose}>Fechar</Button>
        <Button variant="primary" icon={<Download size={15} />} loading={busy === 'import'} disabled={!chosen.length || invalid.length > 0} onClick={doImport}>
          Importar {chosen.length || ''} selecionada(s)
        </Button>
      </>}>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select className="select" style={{ maxWidth: 320 }} value={vpsId} onChange={e => setVpsId(parseInt(e.target.value))}>
          {vpsList.map(v => <option key={v.id} value={v.id}>{v.name} — {v.host}</option>)}
        </select>
        {vps && !vps.gw_ip && <Badge tone="warn">sem gateway — regras via host não serão reconhecidas</Badge>}
        {meta && !meta.host_available && <Badge tone="warn">host indisponível: {meta.host_error}</Badge>}
      </div>

      {imported.length > 0 && (
        <Callout tone="success" title={`${imported.length} porta(s) agora gerenciadas pelo painel`}>
          As regras antigas continuam ativas em paralelo (inofensivas: as cadeias do painel vêm primeiro). Quando quiser, remova-as:
          <div style={{ marginTop: 8 }}><Button size="sm" variant="danger" icon={<Eraser size={14} />} loading={busy === 'clean'} onClick={cleanup}>Limpar regras antigas dessas portas</Button></div>
        </Callout>
      )}

      {error && <Callout tone="danger">{error}</Callout>}
      {!rows && !error && <div className="row muted" style={{ justifyContent: 'center', padding: 40 }}><Loader2 size={16} className="spin" style={{ animation: 'spin 0.8s linear infinite' }} />Lendo iptables da VPS e do host…</div>}
      {rows && rows.length === 0 && <Empty icon={<CheckCircle2 size={22} />} title="Nenhuma regra legada encontrada">Não há DNAT fora das cadeias do painel nesta VPS nem no host.</Empty>}

      {rows && rows.length > 0 && (
        <div className="card" style={{ boxShadow: 'none' }}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 32 }} /><th>Porta</th><th>Caminho encontrado</th><th>Situação</th><th>Descrição</th><th>Ativar</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.exists ? 'dim' : ''}>
                    <td><input type="checkbox" checked={r.selected} disabled={r.exists} onChange={e => set(i, { selected: e.target.checked })} aria-label={`Selecionar porta ${r.port}`} /></td>
                    <td><div className="row" style={{ gap: 6 }}><b className="mono">{r.port}</b><span className="proto">{protoLabel(r.protocol)}</span></div></td>
                    <td>
                      {r.status === 'vps_only' ? (
                        <input className="input mono" style={{ height: 30, width: 170 }} placeholder="IP na LAN" value={r.ip} onChange={e => set(i, { ip: e.target.value.trim() })} />
                      ) : <RulePath r={{ ...r, target_ip: r.ip }} vps={vps} guest={guestFor(r.ip, guests)} />}
                    </td>
                    <td>
                      <div className="stack" style={{ gap: 4 }}>
                        {r.exists ? <Badge>já cadastrada</Badge> : <span title={STATUS[r.status].help}><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></span>}
                        {r.port_in_use && <Badge tone="danger">porta em uso na VPS</Badge>}
                      </div>
                    </td>
                    <td><input className="input" style={{ height: 30, minWidth: 120 }} value={r.description} disabled={r.exists} onChange={e => set(i, { description: e.target.value })} placeholder="—" /></td>
                    <td><Switch on={r.enabled} disabled={r.exists} onChange={v => set(i, { enabled: v })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {invalid.length > 0 && <Callout tone="warn">Informe o IP de destino das portas {invalid.map(r => r.port).join(', ')}.</Callout>}
      <Callout tone="info">
        Regras <b>só no host</b> são resquícios: a VPS não as encaminha hoje. Elas vêm desmarcadas — importar e ativar abre a porta para a internet.
      </Callout>
    </Drawer>
  )
}
