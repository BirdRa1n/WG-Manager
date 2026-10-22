// ── Types ────────────────────────────────────────────────────────────────────────────────
export type Protocol = 'tcp' | 'udp' | 'both'
export type Mode = 'host' | 'direct'

export interface VPS {
  id: number; name: string; host: string; ssh_port: number; ssh_user: string; ssh_host_key: string
  wg_public_key: string | null; wg_address: string | null; wg_listen_port: number; wg_interface: string
  pub_interface: string; gw_ip: string | null; gw_iface: string | null; lan_iface: string | null
  status: string; last_error: string | null; last_seen: string | null; created_at: string; rules: number
}

export interface Forward {
  id: number; vps_id: number; lxc_id: number | null; vmid: number | null; port: number; protocol: Protocol
  mode: Mode; target_ip: string; target_port: number; description: string; enabled: boolean
  source: 'panel' | 'imported'; created_at: string; updated_at: string
}

export interface ApplyResult { ok: boolean; [target: string]: any }

export type HopStatus = 'applied' | 'missing' | 'partial' | 'disabled' | 'n/a'
export interface TargetState {
  name: string; available: boolean; error?: string; installed?: boolean; hooked?: boolean
  stray?: number[]; listening?: { tcp: number[]; udp: number[] }; legacy_count?: number; ip_forward?: string
}
export interface ForwardStatus { targets: Record<string, TargetState>; rules: Record<string, { vps?: HopStatus; host?: HopStatus }> }

export interface LegacyItem {
  protocol: Protocol; port: number; mode: Mode; target_ip: string | null; target_port: number
  vps_spec: string[]; host_spec: string[]; status: 'complete' | 'vps_only' | 'host_only'
  port_in_use: boolean; exists: boolean
}

export interface Guest {
  vmid: number; name: string; type: 'lxc' | 'qemu'; node: string; status: string
  cpus: number; maxmem: number; mem: number; uptime: number; tags: string
  ips: { ip: string; iface: string }[]; managed: ManagedLXC | null; forwards: number
}
export interface ManagedLXC {
  id: number; vmid: number; name: string; proxmox_node: string; wg_public_key: string | null
  wg_address: string | null; wg_vps_id: number | null; status: string
}

export interface Peer {
  pubkey: string; endpoint: string | null; allowed_ips: string | null; last_handshake: number
  rx_bytes: number; tx_bytes: number; keepalive: string | null; label: string | null
  kind: 'host' | 'lxc' | 'unknown'; lxc_id: number | null; orphan: boolean
}

export interface Tunnel {
  id: number; name: string; lxc_id: number | null; tunnel_id: string; account_id: string; status: string
  managed: boolean; lxc: { vmid: number; name: string } | null
  routes: { id: number; public_url: string; service: string; description: string | null }[]
}

export interface Credential {
  id: number; name: string; provider: string; account_id: string; api_token_preview: string
  permissions: string[]; permission_labels: string[]; notes: string; created_at: string
}

export interface Alert { level: 'error' | 'warn' | 'info'; title: string; detail?: string; link?: string | null }
export interface Overview {
  host: { name: string; wg: { name: string; address: string; peers: number }[]; on_proxmox: boolean }
  vps: {
    id: number; name: string; host: string; wg_address: string | null; online: boolean | undefined
    latency_ms?: number; error?: string; peers: number; gw_ip: string | null; gw_iface: string | null
    gw_handshake_age: number | null; rules_host: number; rules_direct: number
  }[]
  alerts: Alert[]
  counts: { forwards: number; containers_wg: number }
}

export interface LogEntry { ts: string; level: string; message: string; operation: string }

// ── Transport ────────────────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-WGM': '1',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
    window.dispatchEvent(new Event('wgm:unauthorized'))
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join('; ') : err.detail
    throw new ApiError(res.status, detail || `Erro ${res.status}`)
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) => req<{ username: string }>('POST', '/auth/login', { username, password }),
  logout: () => req<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => req<{ username: string; dev_auth: boolean }>('GET', '/auth/me'),
  version: () => req<{ version: string }>('GET', '/version'),

  overview: () => req<Overview>('GET', '/system/overview'),
  summary: () => req<any>('GET', '/stats/summary'),
  traffic: () => req<{ ts: string; rx: number; tx: number }[]>('GET', '/stats/traffic'),
  statsWG: (vpsId: number) => req<any[]>('GET', `/stats/wg/${vpsId}`),

  listVPS: () => req<VPS[]>('GET', '/vps'),
  createVPS: (form: FormData) => req<VPS>('POST', '/vps', form),
  updateVPS: (id: number, data: Partial<VPS>) => req<VPS>('PATCH', `/vps/${id}`, data),
  testVPS: (id: number) => req<{ ok: boolean; root?: boolean; error?: string; host_key?: string }>('POST', `/vps/${id}/test`),
  detectVPS: (id: number) => req<any>('POST', `/vps/${id}/detect`),
  installWGVPS: (id: number) => req<any>('POST', `/vps/${id}/install-wireguard`),
  connectHost: (id: number) => req<{ ok: boolean; reused?: boolean; handshake?: boolean; gateway: { ip: string; iface: string }; vps_address?: string; readdressed?: boolean; port?: number }>('POST', `/vps/${id}/connect-host`),
  resetHostKey: (id: number) => req<VPS>('POST', `/vps/${id}/reset-host-key`),
  peers: (id: number) => req<Peer[]>('GET', `/vps/${id}/peers`),
  removePeer: (id: number, pubkey: string) => req<any>('POST', `/vps/${id}/peers/remove`, { pubkey }),
  deleteVPS: (id: number) => req<any>('DELETE', `/vps/${id}`),

  listForwards: () => req<Forward[]>('GET', '/forwards'),
  forwardStatus: () => req<ForwardStatus>('GET', '/forwards/status'),
  createForward: (data: Partial<Forward>) => req<{ rule: Forward; apply: ApplyResult }>('POST', '/forwards', data),
  updateForward: (id: number, data: Partial<Forward>) => req<{ rule: Forward; apply: ApplyResult }>('PUT', `/forwards/${id}`, data),
  toggleForward: (id: number) => req<{ rule: Forward; apply: ApplyResult }>('PATCH', `/forwards/${id}/toggle`),
  deleteForward: (id: number) => req<{ ok: boolean; apply: ApplyResult }>('DELETE', `/forwards/${id}`),
  applyAll: () => req<ApplyResult>('POST', '/forwards/apply'),
  legacy: (vpsId: number) => req<{ items: LegacyItem[]; gw_ip: string | null; host_available: boolean; host_error?: string }>('GET', `/forwards/legacy/${vpsId}`),
  importLegacy: (vpsId: number, items: any[]) => req<{ imported: number; apply: ApplyResult }>('POST', `/forwards/legacy/${vpsId}/import`, items),
  cleanupLegacy: (vpsId: number, data: { vps_spec: string[]; host_spec: string[] }) => req<any>('POST', `/forwards/legacy/${vpsId}/cleanup`, data),

  guests: (refresh = false) => req<Guest[]>('GET', `/lxc/guests${refresh ? '?refresh=true' : ''}`),
  listLXC: () => req<ManagedLXC[]>('GET', '/lxc'),
  importLXC: (data: { vmid: number; name: string; proxmox_node: string }) => req<ManagedLXC>('POST', '/lxc', data),
  checkWG: (id: number) => req<any>('GET', `/lxc/${id}/check-wg`),
  checkPermissions: (id: number) => req<{ ok: boolean; issues: { key: string; message: string; fixable: boolean }[] }>('POST', `/lxc/${id}/check-permissions`),
  fixPermissions: (id: number) => req<{ ok: boolean; output: string; restart_required: boolean }>('POST', `/lxc/${id}/fix-permissions`),
  installWGLXC: (id: number, vps_id: number, full_tunnel: boolean) => req<any>('POST', `/lxc/${id}/install-wireguard`, { vps_id, full_tunnel }),
  removeWGLXC: (id: number) => req<any>('POST', `/lxc/${id}/remove-wireguard`),
  deleteLXC: (id: number, forget = false) => req<any>('DELETE', `/lxc/${id}${forget ? '?forget=true' : ''}`),

  listTunnels: () => req<Tunnel[]>('GET', '/tunnels'),
  createTunnel: (data: any) => req<Tunnel>('POST', '/tunnels', data),
  addRoute: (id: number, data: any) => req<any>('POST', `/tunnels/${id}/routes`, data),
  deleteRoute: (id: number, routeId: number) => req<any>('DELETE', `/tunnels/${id}/routes/${routeId}`),
  deleteTunnel: (id: number) => req<any>('DELETE', `/tunnels/${id}`),
  tunnelStatus: (id: number) => req<{ status: string }>('GET', `/tunnels/${id}/status`),
  installCloudflared: (id: number) => req<any>('POST', `/tunnels/${id}/install`),

  listCredentials: () => req<Credential[]>('GET', '/credentials'),
  createCredential: (data: any) => req<Credential>('POST', '/credentials', data),
  verifyCredential: (id: number) => req<any>('POST', `/credentials/${id}/verify`),
  deleteCredential: (id: number) => req<any>('DELETE', `/credentials/${id}`),

  logHistory: () => req<LogEntry[]>('GET', '/events/history'),
}

export function eventStream(): EventSource {
  return new EventSource('/api/events/stream', { withCredentials: true })
}
