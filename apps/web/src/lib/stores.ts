import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine } from '@abarrotes/shared';
import { lineTotalCents, sumCents } from '@abarrotes/shared';

/** Sucursal activa (persistida). */
interface SucursalState {
  sucursalId: string | null;
  setSucursal: (id: string) => void;
}
export const useSucursal = create<SucursalState>()(
  persist((set) => ({ sucursalId: null, setSucursal: (id) => set({ sucursalId: id }) }), {
    name: 'abarrotes-sucursal',
  }),
);

/** Caja activa (persistida). */
interface RegisterState {
  registerId: string | null;
  cashSessionId: string | null;
  setRegister: (id: string) => void;
  setCashSession: (id: string | null) => void;
}
export const useRegister = create<RegisterState>()(
  persist(
    (set) => ({
      registerId: null,
      cashSessionId: null,
      setRegister: (id) => set({ registerId: id }),
      setCashSession: (id) => set({ cashSessionId: id }),
    }),
    { name: 'abarrotes-register' },
  ),
);

/** Carrito del POS (en memoria). */
interface CartState {
  lines: CartLine[];
  add: (line: CartLine) => void;
  remove: (index: number) => void;
  clear: () => void;
  totalCents: () => number;
}
export const useCart = create<CartState>((set, get) => ({
  lines: [],
  add: (line) => set((s) => ({ lines: [...s.lines, line] })),
  remove: (index) =>
    set((s) => ({ lines: s.lines.filter((_, i) => i !== index) })),
  clear: () => set({ lines: [] }),
  totalCents: () =>
    sumCents(
      get().lines.map((l) =>
        lineTotalCents(l.unitPrice, l.quantity, l.discount),
      ),
    ),
}));
