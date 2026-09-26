/** 工具材料种类 */
export type SupplyKind = '工具' | '磨料' | '胶种' | '耗材';

export const SUPPLY_KINDS: SupplyKind[] = ['工具', '磨料', '胶种', '耗材'];

/** 工具材料批次 */
export interface SupplyLot {
  id: string;
  name: string;
  kind: SupplyKind;
  /** 规格 */
  spec: string;
  /** 批号 */
  lotNo: string;
  /** 在库数量 */
  qty: number;
  unit: string;
  /** 开封时间 */
  openedAt: number;
  /** 保质期（月） */
  shelfLifeMonths: number;
  /** 低量阈值 */
  lowThreshold: number;
  /** 领用流水（含退回、作废去向） */
  issues: SupplyIssue[];
}

/** 领用登记：关联标本与工序，退回 / 作废分段记账 */
export interface SupplyIssue {
  id: string;
  qty: number;
  operator: string;
  specimenNo: string;
  /** 关联标本 id（未关联时为空） */
  specimenId?: string;
  /** 关联工序节点 id（未关联时为空） */
  procedureId?: string;
  /** 工序快照文案，工序被移除后去向仍可追溯 */
  procedureLabel?: string;
  issuedAt: number;
  /** 已退回数量（退回即回库） */
  returnedQty: number;
  returnedAt?: number;
  /** 退回备注（去向说明） */
  returnNote?: string;
  /** 已作废数量（工序回退 / 移除时自动作废并回库） */
  voidedQty: number;
  voidedAt?: number;
  /** 作废原因，如「工序回退」「工序移除」 */
  voidReason?: string;
}

export type SupplyLotDraft = Omit<SupplyLot, 'id' | 'issues'>;

/** 领用登记入参：数量 / 领用人 / 去向必填，其余由 store 补默认 */
export type SupplyIssueDraft = Pick<SupplyIssue, 'qty' | 'operator' | 'specimenNo'> &
  Partial<Pick<SupplyIssue, 'specimenId' | 'procedureId' | 'procedureLabel'>>;

/** 领用记录的在用数量（未退回也未作废的部分） */
export function issueOutstanding(issue: SupplyIssue): number {
  return Math.max(0, issue.qty - issue.returnedQty - issue.voidedQty);
}

/** 领用记录状态：有作废记作废，无在用记已退回，否则在用 */
export type SupplyIssueStatus = 'issued' | 'returned' | 'voided';

export function issueStatus(issue: SupplyIssue): SupplyIssueStatus {
  if (issue.voidedQty > 0) return 'voided';
  if (issueOutstanding(issue) === 0) return 'returned';
  return 'issued';
}

export const ISSUE_STATUS_LABEL: Record<SupplyIssueStatus, string> = {
  issued: '在用',
  returned: '已退回',
  voided: '已作废',
};

/** 按批号汇总的台账：累计领用 / 退回 / 作废 / 在用 */
export interface LotLedger {
  issued: number;
  returned: number;
  voided: number;
  outstanding: number;
}

export function lotLedger(lot: SupplyLot): LotLedger {
  const issued = lot.issues.reduce((sum, it) => sum + it.qty, 0);
  const returned = lot.issues.reduce((sum, it) => sum + it.returnedQty, 0);
  const voided = lot.issues.reduce((sum, it) => sum + it.voidedQty, 0);
  return { issued, returned, voided, outstanding: issued - returned - voided };
}

/** 是否低量 */
export function isLowStock(lot: SupplyLot): boolean {
  return lot.qty <= lot.lowThreshold;
}

/** 剩余保质期天数（负数表示已过期） */
export function shelfLifeLeftDays(lot: SupplyLot, now = Date.now()): number {
  const expireAt = lot.openedAt + lot.shelfLifeMonths * 30 * 24 * 3600 * 1000;
  return Math.floor((expireAt - now) / (24 * 3600 * 1000));
}
