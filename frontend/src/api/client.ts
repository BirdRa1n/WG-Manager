const BASE = '/api'

function getToken() {
  return localStorage.getItem('token') || ''
}

function headers(extra: Record<string, string> = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...extra }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body instanceof FormData ? { Authorization: `Bearer ${getToken()}` } : headers(),
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; username: string; proxmox_ticket: string; proxmox_csrf: string }>(
      'POST', '/auth/login', { username, password }
    ),
  me: () => req<{ username: string }>('GET', '/auth/me'),

  // VPS
  listVPS: () => req<any[]>('GET', '/vps'),
  createVPS: (form: FormData) => req<any>('POST', '/vps', form),
  testVPS: (id: number) => req<{ ok: boolean }>('POST', `/vps/${id}/test`),
  installWGVPS: (id: number) => req<any>('POST', `/vps/${id}/install-wireguard`),
  detectWGVPS: (id: number) => req<any>('POST', `/vps/${id}/detect-wireguard`),
  deleteVPS: (id: number) => req<any>('DELETE', `/vps/${id}`),
  wgStatusVPS: (id: number) => req<{ output: string }>('GET', `/vps/${id}/wg-status`),
  wgPeers: (id: number) => req<any[]>('GET', `/vps/${id}/wg-peers`),

  // LXC
  listProxmoxLXC: (ticket: string, node = 'pve') =>
    req<any[]>('GET', `/lxc/proxmox-list?ticket=${encodeURIComponent(ticket)}&node=${node}`),
  listLXC: () => req<any[]>('GET', '/lxc'),
  importLXC: (data: any) => req<any>('POST', '/lxc', data),
  checkPermissions: (id: number) => req<any>('POST', `/lxc/${id}/check-permissions`),
  fixPermissions: (id: number, ticket: string, csrf: string) =>
    req<any>('POST', `/lxc/${id}/fix-permissions?ticket=${encodeURIComponent(ticket)}&csrf=${encodeURIComponent(csrf)}`),
  installWGLXC: (id: number, vpsId: number, mode: string) =>
    req<any>('POST', `/lxc/${id}/install-wireguard?vps_id=${vpsId}&mode=${mode}`),
  checkWGExisting: (id: number) =>
    req<{ installed: boolean; running: boolean; config_exists: boolean; peer: string; config_preview: string }>('GET', `/lxc/${id}/check-wg-existing`),
  removeWGLXC: (id: number) => req<any>('POST', `/lxc/${id}/remove-wireguard`),
  deleteLXC: (id: number) => req<any>('DELETE', `/lxc/${id}`),

  // Ports
  listPorts: () => req<any[]>('GET', '/ports'),
  createPort: (data: any) => req<any>('POST', '/ports', data),
  deletePort: (id: number) => req<any>('DELETE', `/ports/${id}`),
  updatePort: (id: number, data: any) => req<any>('PUT', `/ports/${id}`, data),
  togglePort: (id: number) => req<any>('PATCH', `/ports/${id}/toggle`),
  syncFromVPS: (vpsId: number) =>
    req<{ live_rules: any[]; missing_in_db: any[]; missing_on_vps: any[]; raw_output: string }>(
      'GET', `/ports/sync/${vpsId}`
    ),
  importFromVPS: (vpsId: number, rules: any[]) => req<any>('POST', `/ports/import/${vpsId}`, rules),
  applyMissingToVPS: (vpsId: number, rules: any[]) => req<any>('POST', `/ports/apply-missing/${vpsId}`, rules),

  // Cloudflare Tunnels
  listTunnels: () => req<any[]>('GET', '/tunnels'),
  createTunnel: (data: any) => req<any>('POST', '/tunnels', data),
  addRoute: (tunnelId: number, data: any) => req<any>('POST', `/tunnels/${tunnelId}/routes`, data),
  deleteRoute: (tunnelId: number, routeId: number) => req<any>('DELETE', `/tunnels/${tunnelId}/routes/${routeId}`),
  deleteTunnel: (id: number) => req<any>('DELETE', `/tunnels/${id}`),
  tunnelStatus: (id: number) => req<{ status: string }>('GET', `/tunnels/${id}/status`),
  installCloudflared: (id: number) => req<any>('POST', `/tunnels/${id}/install`),

  // Credentials
  listCredentials: () => req<any[]>('GET', '/credentials'),
  createCredential: (data: any) => req<any>('POST', '/credentials', data),
  verifyCredential: (id: number) => req<any>('POST', `/credentials/${id}/verify`),
  deleteCredential: (id: number) => req<any>('DELETE', `/credentials/${id}`),
  getActiveCFCredential: () => req<any>('GET', '/credentials/cloudflare/active'),

  // Version
  getVersion: () => req<{ version: string }>('GET', '/version'),

  // Stats
  statsSummary: () => req<any>('GET', '/stats/summary'),
  statsWG: (vpsId: number) => req<any[]>('GET', `/stats/wg/${vpsId}`),

  // Logs
  logHistory: () => req<any[]>('GET', '/events/history'),
}

export function createEventSource(): EventSource {
  return new EventSource(`${BASE}/events/stream?token=${getToken()}`)
}
