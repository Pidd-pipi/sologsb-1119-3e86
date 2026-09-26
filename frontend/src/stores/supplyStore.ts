import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  issueOutstanding,
  type SupplyIssue,
  type SupplyIssueDraft,
  type SupplyLot,
  type SupplyLotDraft,
} from '../types/supply';

interface SupplyState {
  items: SupplyLot[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: SupplyLotDraft) => Promise<SupplyLot>;
  issue: (id: string, payload: SupplyIssueDraft) => Promise<void>;
  /** 退回：按批次回库并保留去向备注 */
  returnIssue: (lotId: string, issueId: string, qty: number, note?: string) => Promise<void>;
  /** 工序回退 / 移除时调用：该工序名下未退回的领用全部作废并回库，返回作废笔数 */
  voidIssuesForProcedure: (procedureId: string, reason: string) => Promise<number>;
  trace: (lotNo: string) => SupplyLot[];
}

export const useSupplyStore = create<SupplyState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.supplies.toArray();
    items.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    set({ items, loaded: true });
  },
  async add(draft) {
    const record: SupplyLot = { ...draft, id: newId('sup'), issues: [] };
    await db.supplies.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async issue(id, payload) {
    const target = get().items.find((it) => it.id === id);
    if (!target) return;
    const issue: SupplyIssue = {
      ...payload,
      id: newId('iss'),
      issuedAt: Date.now(),
      returnedQty: 0,
      voidedQty: 0,
    };
    const next: SupplyLot = {
      ...target,
      qty: Math.max(0, target.qty - payload.qty),
      issues: [issue, ...target.issues],
    };
    await db.supplies.put(next);
    set({ items: get().items.map((it) => (it.id === id ? next : it)) });
  },
  async returnIssue(lotId, issueId, qty, note) {
    const target = get().items.find((it) => it.id === lotId);
    if (!target) return;
    const idx = target.issues.findIndex((it) => it.id === issueId);
    if (idx < 0) return;
    const current = target.issues[idx];
    const back = Math.min(Math.max(0, qty), issueOutstanding(current));
    if (back <= 0) return;
    const patched: SupplyIssue = {
      ...current,
      returnedQty: current.returnedQty + back,
      returnedAt: Date.now(),
      returnNote: note?.trim() || current.returnNote,
    };
    const issues = target.issues.slice();
    issues[idx] = patched;
    const next: SupplyLot = { ...target, qty: target.qty + back, issues };
    await db.supplies.put(next);
    set({ items: get().items.map((it) => (it.id === lotId ? next : it)) });
  },
  async voidIssuesForProcedure(procedureId, reason) {
    const now = Date.now();
    let voidedCount = 0;
    const changed: SupplyLot[] = [];
    const nextItems = get().items.map((lot) => {
      let restored = 0;
      const issues = lot.issues.map((iss) => {
        if (iss.procedureId !== procedureId) return iss;
        const outstanding = issueOutstanding(iss);
        if (outstanding <= 0) return iss;
        restored += outstanding;
        voidedCount += 1;
        return {
          ...iss,
          voidedQty: iss.voidedQty + outstanding,
          voidedAt: now,
          voidReason: reason,
        };
      });
      if (restored === 0) return lot;
      const next: SupplyLot = { ...lot, qty: lot.qty + restored, issues };
      changed.push(next);
      return next;
    });
    if (changed.length === 0) return 0;
    await Promise.all(changed.map((lot) => db.supplies.put(lot)));
    set({ items: nextItems });
    return voidedCount;
  },
  trace(lotNo) {
    if (!lotNo) return get().items;
    return get().items.filter((it) => it.lotNo.includes(lotNo) || it.name.includes(lotNo));
  },
}));
