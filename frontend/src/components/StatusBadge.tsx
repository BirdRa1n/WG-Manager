import { C } from '../theme'

const MAP: Record<string, { label: string; color: string }> = {
  wg_ready:  { label: 'WG Ativo',  color: C.green  },
  running:   { label: 'Rodando',   color: C.green  },
  connected: { label: 'Conectado', color: C.blue   },
  ready:     { label: 'Pronto',    color: C.blue   },
  imported:  { label: 'Importado', color: C.text2  },
  stopped:   { label: 'Parado',    color: C.red    },
  error:     { label: 'Erro',      color: C.red    },
  pending:   { label: 'Pendente',  color: C.yellow },
  created:   { label: 'Criado',    color: C.yellow },
}

export default function StatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, color: C.text2 }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.color + '18', color: s.color,
      border: `1px solid ${s.color}35`,
      borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
  )
}
