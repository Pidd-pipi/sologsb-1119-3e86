import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { useSupplyStore, type VoidResult } from './supplyStore';
import type { PrepProcedure, PrepProcedureDraft } from '../types/procedure';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  finish: (id: string) => Promise<void>;
  rollback: (id: string, reason?: string) => Promise<VoidResult>;
  remove: (id: string) => Promise<VoidResult>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
}

/**
 * 工序回退/移除共用：更新工序的同时，把该工序未退回的领用自动作废、恢复库存。
 * supplies 操作在同一个 Dexie 事务内，避免工序已改而库存未恢复的断档。
 */
async function settleProcedure(
  id: string,
  mutate: (tx: typeof db) => Promise<void>,
  voidReason: string,
): Promise<VoidResult> {
  return db.transaction('rw', db.procedures, db.supplies, async () => {
    await mutate(db);
    return useSupplyStore.getState().voidByProcedure(id, voidReason);
  });
}

export const useProcedureStore = create<ProcedureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.procedures.toArray();
    items.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async add(draft) {
    const record: PrepProcedure = { ...draft, id: newId('prc') };
    await db.procedures.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async finish(id) {
    const patch: Partial<PrepProcedure> = { state: 'done', finishedAt: Date.now() };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async rollback(id) {
    const result = await settleProcedure(
      id,
      async (tx) => {
        const patch: Partial<PrepProcedure> = { state: 'rolledback', finishedAt: undefined };
        await tx.procedures.update(id, patch);
      },
      '工序已回退',
    );
    set({
      items: get().items.map((it) =>
        it.id === id ? { ...it, state: 'rolledback', finishedAt: undefined } : it,
      ),
    });
    return result;
  },
  async remove(id) {
    const result = await settleProcedure(
      id,
      async (tx) => {
        await tx.procedures.delete(id);
      },
      '工序已移除',
    );
    set({ items: get().items.filter((it) => it.id !== id) });
    return result;
  },
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
