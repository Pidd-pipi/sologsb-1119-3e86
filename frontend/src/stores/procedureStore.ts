import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { PrepProcedure, PrepProcedureDraft } from '../types/procedure';
import { useSupplyStore } from './supplyStore';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  finish: (id: string) => Promise<void>;
  /** 回退节点：该节点名下未退回的领用自动作废回库，返回作废笔数 */
  rollback: (id: string, reason?: string) => Promise<number>;
  /** 移除节点：同样作废关联领用并回库，返回作废笔数 */
  remove: (id: string) => Promise<number>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
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
    const patch: Partial<PrepProcedure> = { state: 'rolledback', finishedAt: undefined };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
    return useSupplyStore.getState().voidIssuesForProcedure(id, '工序回退');
  },
  async remove(id) {
    await db.procedures.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
    return useSupplyStore.getState().voidIssuesForProcedure(id, '工序移除');
  },
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
