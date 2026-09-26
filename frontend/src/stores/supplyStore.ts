import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  issueOutstandingQty,
  issueReturnedQty,
  type IssueStatus,
  type SupplyIssue,
  type SupplyIssueDraft,
  type SupplyLot,
  type SupplyLotDraft,
} from '../types/supply';

/** 工序回退/移除后的作废结果，供页面提示库存恢复情况 */
export interface VoidResult {
  voidedIssueCount: number;
  restoredQty: number;
  unitByLot: Record<string, string>;
}

interface SupplyState {
  items: SupplyLot[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: SupplyLotDraft) => Promise<SupplyLot>;
  issue: (id: string, payload: SupplyIssueDraft) => Promise<void>;
  returnIssue: (lotId: string, issueId: string, qty: number, operator: string, reason?: string) => Promise<void>;
  /** 工序回退或被移除后，把未退回的领用自动作废并恢复库存（可在调用方的事务中执行） */
  voidByProcedure: (procedureId: string, reason: string) => Promise<VoidResult>;
  trace: (lotNo: string) => SupplyLot[];
}

/** 纯函数：对一批批次按工序作废领用，返回更新后的批次与恢复数量 */
function applyVoidToLots(lots: SupplyLot[], procedureId: string, reason: string, now: number): {
  lots: SupplyLot[];
  result: VoidResult;
} {
  const result: VoidResult = { voidedIssueCount: 0, restoredQty: 0, unitByLot: {} };
  const nextLots = lots.map((lot) => {
    let touched = false;
    let restoredByLot = 0;
    const issues = lot.issues.map((iss) => {
      if (iss.procedureId !== procedureId || iss.status !== 'issued') return iss;
      const outstanding = issueOutstandingQty(iss);
      if (outstanding <= 0) return iss;
      touched = true;
      restoredByLot += outstanding;
      result.voidedIssueCount += 1;
      const next: SupplyIssue = {
        ...iss,
        status: 'voided' as IssueStatus,
        voidedAt: now,
        voidReason: reason,
      };
      return next;
    });
    if (!touched) return lot;
    result.restoredQty += restoredByLot;
    result.unitByLot[lot.id] = lot.unit;
    return { ...lot, qty: lot.qty + restoredByLot, issues };
  });
  return { lots: nextLots, result };
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
    if (!target) throw new Error('未找到材料批次');
    if (payload.qty <= 0) throw new Error('领用数量必须大于 0');
    if (payload.qty > target.qty) {
      throw new Error(`库存不足：现存 ${target.qty} ${target.unit}`);
    }
    const issue: SupplyIssue = {
      ...payload,
      id: newId('iss'),
      issuedAt: Date.now(),
      status: 'issued',
      returns: [],
    };
    const next: SupplyLot = {
      ...target,
      qty: target.qty - payload.qty,
      issues: [issue, ...target.issues],
    };
    await db.supplies.put(next);
    set({ items: get().items.map((it) => (it.id === id ? next : it)) });
  },
  async returnIssue(lotId, issueId, qty, operator, reason) {
    const target = get().items.find((it) => it.id === lotId);
    if (!target) throw new Error('未找到材料批次');
    const issue = target.issues.find((it) => it.id === issueId);
    if (!issue || issue.status !== 'issued') throw new Error('该领用单不可退回');
    const outstanding = issueOutstandingQty(issue);
    if (qty <= 0 || qty > outstanding) {
      throw new Error(`退回数量需在 1 ~ ${outstanding} ${target.unit} 之间`);
    }
    const returns = [
      ...issue.returns,
      { id: newId('ret'), qty, operator: operator.trim() || issue.operator, reason: reason?.trim() || undefined, returnedAt: Date.now() },
    ];
    const fullyReturned = issueReturnedQty({ ...issue, returns }) >= issue.qty;
    const nextIssue: SupplyIssue = {
      ...issue,
      returns,
      status: fullyReturned ? 'returned' : 'issued',
    };
    const nextLot: SupplyLot = {
      ...target,
      qty: target.qty + qty,
      issues: target.issues.map((it) => (it.id === issueId ? nextIssue : it)),
    };
    await db.supplies.put(nextLot);
    set({ items: get().items.map((it) => (it.id === lotId ? nextLot : it)) });
  },
  async voidByProcedure(procedureId, reason) {
    // 直接读库，保证在 procedureStore 的 Dexie 事务里也能拿到最新数据并并入同一事务
    const lots = await db.supplies.toArray();
    const { lots: nextLots, result } = applyVoidToLots(lots, procedureId, reason, Date.now());
    if (result.voidedIssueCount > 0) {
      await db.supplies.bulkPut(nextLots);
      const stateItems = get().items;
      if (stateItems.length > 0) {
        set({
          items: stateItems.map((it) => nextLots.find((l) => l.id === it.id) ?? it),
        });
      }
    }
    return result;
  },
  trace(lotNo) {
    if (!lotNo) return get().items;
    return get().items.filter((it) => it.lotNo.includes(lotNo) || it.name.includes(lotNo));
  },
}));
