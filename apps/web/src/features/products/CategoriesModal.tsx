import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal, EmptyState } from '@/components/ui';

const SUGGESTED = [
  'Abarrotes',
  'Bebidas',
  'Botanas',
  'Lácteos',
  'Limpieza',
  'Higiene',
  'Dulces',
  'Cigarros',
  'Panadería',
  'Enlatados',
];

interface Cat {
  id: string;
  name: string;
}

/** Gestor de categorías de la sucursal (tabla única → escritura directa por RLS). */
export function CategoriesModal({
  sucursalId,
  onClose,
}: {
  sucursalId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<Cat[]> => {
      const { data } = await supabase
        .from('categories')
        .select('id,name')
        .eq('sucursal_id', sucursalId!)
        .order('name');
      return (data ?? []) as Cat[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });

  async function add(name: string) {
    const n = name.trim();
    if (!n || !sucursalId) return;
    setBusy(true);
    const { error } = await supabase
      .from('categories')
      .insert({ sucursal_id: sucursalId, name: n });
    setBusy(false);
    if (error) return toast.error(error.message);
    setNewName('');
    await refresh();
    toast.success('Categoría creada');
  }

  async function addSuggested() {
    if (!sucursalId) return;
    const existing = new Set(categories.map((c) => c.name.toLowerCase()));
    const rows = SUGGESTED.filter((n) => !existing.has(n.toLowerCase())).map(
      (name) => ({ sucursal_id: sucursalId, name }),
    );
    if (rows.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from('categories').insert(rows);
    setBusy(false);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success(`${rows.length} categorías creadas`);
  }

  async function rename(id: string) {
    const n = editName.trim();
    if (!n) return;
    const { error } = await supabase
      .from('categories')
      .update({ name: n })
      .eq('id', id);
    if (error) return toast.error(error.message);
    setEditId(null);
    await refresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success('Categoría eliminada');
  }

  return (
    <Modal title="Categorías" onClose={onClose} maxWidth={440}>
      <div className="flex gap-sm" style={{ marginBottom: 12 }}>
        <input
          className="field"
          placeholder="Nueva categoría…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add(newName);
          }}
        />
        <button
          className="btn accent"
          disabled={busy || !newName.trim()}
          onClick={() => void add(newName)}
        >
          <Plus size={14} /> Agregar
        </button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="Sin categorías"
          hint="Crea la primera o usa un set sugerido para abarrotes."
          action={
            <button
              className="btn"
              disabled={busy}
              onClick={() => void addSuggested()}
            >
              <Sparkles size={14} /> Crear categorías sugeridas
            </button>
          }
        />
      ) : (
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-sm"
              style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
            >
              {editId === c.id ? (
                <>
                  <input
                    className="field"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(c.id);
                      if (e.key === 'Escape') setEditId(null);
                    }}
                  />
                  <button
                    className="btn ghost sm"
                    onClick={() => void rename(c.id)}
                    aria-label="Guardar"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => setEditId(null)}
                    aria-label="Cancelar"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setEditId(c.id);
                      setEditName(c.name);
                    }}
                    aria-label="Renombrar"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => void remove(c.id)}
                    aria-label="Eliminar"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
