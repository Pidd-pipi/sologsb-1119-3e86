/** 工具材料种类 */
export type SupplyKind = '工具' | '磨料' | '胶种' | '耗材';

export const SUPPLY_KINDS: SupplyKind[] = ['工具', '磨料', '胶种', '耗材'];

/** 领用单状态：领用中可部分/全部退回；工序回退或移除后自动作废 */
export type IssueStatus = 'issued' | 'returned' | 'voided';

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  issued: '领用中',
  returned: '已退回',
  voided: '已作废',
};

/** 退回登记（一张领用单可分多次退回） */
export interface SupplyReturn {
  id: string;
  qty: number;
  operator: string;
  /** 退回原因/说明，保留去向 */
  reason?: string;
  returnedAt: number;
}

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
  /** 领用/退回/作废流水（最新在前） */
  issues: SupplyIssue[];
}

/** 领用登记 */
export interface SupplyIssue {
  id: string;
  qty: number;
  /** 领用时的单位快照 */
  unit: string;
  operator: string;
  /** 关联标本 */
  specimenId: string;
  specimenNo: string;
  /** 关联工序（可空：仅按标本留痕的领用不随工序作废） */
  procedureId?: string;
  procedureSeq?: number;
  procedureName?: string;
  issuedAt: number;
  status: IssueStatus;
  /** 退回明细，保留每一次去向 */
  returns: SupplyReturn[];
  voidedAt?: number;
  /** 作废原因，如「工序已回退」「工序已移除」 */
  voidReason?: string;
}

/** 新建领用的入参 */
export type SupplyIssueDraft = Omit<
  SupplyIssue,
  'id' | 'issuedAt' | 'status' | 'returns'
>;

export type SupplyLotDraft = Omit<SupplyLot, 'id' | 'issues'>;

/** 该领用单已退回数量 */
export function issueReturnedQty(issue: SupplyIssue): number {
  return issue.returns.reduce((sum, r) => sum + r.qty, 0);
}

/** 该领用单尚未退回的在外数量；已作废的领用不再占用库存 */
export function issueOutstandingQty(issue: SupplyIssue): number {
  if (issue.status !== 'issued') return 0;
  return Math.max(0, issue.qty - issueReturnedQty(issue));
}

/** 按批号汇总的台账数量 */
export interface LotLedgerSummary {
  /** 累计领用 */
  issuedQty: number;
  /** 累计退回 */
  returnedQty: number;
  /** 累计作废（作废时未退回的部分，库存已恢复） */
  voidedQty: number;
  /** 在外未结：领用 - 退回 - 作废 */
  outstandingQty: number;
}

/** 材料台账按批号汇总领用、退回和作废数量，保证同批材料去向不断档 */
export function summarizeLot(lot: SupplyLot): LotLedgerSummary {
  const summary: LotLedgerSummary = { issuedQty: 0, returnedQty: 0, voidedQty: 0, outstandingQty: 0 };
  for (const issue of lot.issues) {
    summary.issuedQty += issue.qty;
    summary.returnedQty += issueReturnedQty(issue);
    if (issue.status === 'voided') {
      summary.voidedQty += Math.max(0, issue.qty - issueReturnedQty(issue));
    }
  }
  summary.outstandingQty = summary.issuedQty - summary.returnedQty - summary.voidedQty;
  return summary;
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
