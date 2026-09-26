import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import AddIcon from '@mui/icons-material/Add';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import UndoIcon from '@mui/icons-material/Undo';
import { useSupplyStore } from '../stores/supplyStore';
import { useSpecimenStore } from '../stores/specimenStore';
import { useProcedureStore } from '../stores/procedureStore';
import { MeasureField } from '../components/common/MeasureField';
import {
  ISSUE_STATUS_LABEL,
  SUPPLY_KINDS,
  isLowStock,
  issueOutstandingQty,
  issueReturnedQty,
  shelfLifeLeftDays,
  summarizeLot,
  type IssueStatus,
  type SupplyKind,
  type SupplyIssue,
  type SupplyLot,
  type SupplyLotDraft,
} from '../types/supply';

const EMPTY_DRAFT: SupplyLotDraft = {
  name: '',
  kind: '胶种',
  spec: '',
  lotNo: '',
  qty: 1,
  unit: '瓶',
  openedAt: Date.now(),
  shelfLifeMonths: 24,
  lowThreshold: 2,
};

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_COLOR: Record<IssueStatus, 'primary' | 'success' | 'error'> = {
  issued: 'primary',
  returned: 'success',
  voided: 'error',
};

/** /supplies 工具材料台账：按种类分组、批号追溯、领用/退回/作废流水 */
export default function SupplyList() {
  const lots = useSupplyStore((s) => s.items);
  const addLot = useSupplyStore((s) => s.add);
  const issue = useSupplyStore((s) => s.issue);
  const returnIssue = useSupplyStore((s) => s.returnIssue);
  const specimens = useSpecimenStore((s) => s.items);
  const procedures = useProcedureStore((s) => s.items);

  const [trace, setTrace] = useState('');
  const [kindFilter, setKindFilter] = useState<SupplyKind | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<SupplyLotDraft>(EMPTY_DRAFT);
  const [issueTarget, setIssueTarget] = useState<SupplyLot | null>(null);
  const [issueQty, setIssueQty] = useState(1);
  const [issueOperator, setIssueOperator] = useState('');
  const [issueSpecimenId, setIssueSpecimenId] = useState('');
  const [issueProcedureId, setIssueProcedureId] = useState('');
  const [ledgerLot, setLedgerLot] = useState<SupplyLot | null>(null);
  const [returnTarget, setReturnTarget] = useState<{ lot: SupplyLot; issue: SupplyIssue } | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returnOperator, setReturnOperator] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const filtered = useMemo(() => {
    const kw = trace.trim();
    return lots.filter((lot) => {
      if (kindFilter !== 'all' && lot.kind !== kindFilter) return false;
      if (kw && !lot.lotNo.includes(kw) && !lot.name.includes(kw) && !lot.spec.includes(kw)) return false;
      return true;
    });
  }, [lots, trace, kindFilter]);

  const grouped = useMemo(() => {
    return SUPPLY_KINDS.map((kind) => ({ kind, rows: filtered.filter((lot) => lot.kind === kind) })).filter(
      (g) => kindFilter === 'all' || g.kind === kindFilter,
    );
  }, [filtered, kindFilter]);

  /** 台账弹窗始终展示 store 里的最新批次 */
  const ledgerLotLive = useMemo(
    () => (ledgerLot ? lots.find((l) => l.id === ledgerLot.id) ?? null : null),
    [ledgerLot, lots],
  );

  const specimenById = useMemo(() => new Map(specimens.map((s) => [s.id, s])), [specimens]);

  /** 选中标本下可挂接的工序（已移除的不可选；已回退的也允许挂接但会提示会随回退作废） */
  const procedureOptions = useMemo(() => {
    if (!issueSpecimenId) return [];
    return procedures
      .filter((p) => p.specimenId === issueSpecimenId)
      .sort((a, b) => a.seq - b.seq);
  }, [procedures, issueSpecimenId]);

  const submitLot = async () => {
    if (!draft.name.trim() || !draft.lotNo.trim()) {
      setError('名称与批号必填');
      return;
    }
    await addLot({ ...draft, name: draft.name.trim(), lotNo: draft.lotNo.trim() });
    setCreateOpen(false);
    setDraft(EMPTY_DRAFT);
    setError('');
    setToast('已登记材料批次');
  };

  const openIssue = (lot: SupplyLot) => {
    setIssueTarget(lot);
    setIssueQty(1);
    setIssueOperator('');
    setIssueSpecimenId(specimens[0]?.id ?? '');
    setIssueProcedureId('');
    setError('');
  };

  const submitIssue = async () => {
    if (!issueTarget) return;
    if (issueQty <= 0 || issueQty > issueTarget.qty) {
      setError(`领用数量需在 1 ~ ${issueTarget.qty} ${issueTarget.unit} 之间`);
      return;
    }
    if (!issueOperator.trim()) {
      setError('领用人必填');
      return;
    }
    if (!issueSpecimenId) {
      setError('请选择领用标本（材料去向需关联标本留痕）');
      return;
    }
    const specimen = specimenById.get(issueSpecimenId);
    const proc = procedureOptions.find((p) => p.id === issueProcedureId);
    try {
      await issue(issueTarget.id, {
        qty: issueQty,
        unit: issueTarget.unit,
        operator: issueOperator.trim(),
        specimenId: specimen!.id,
        specimenNo: specimen!.specimenNo,
        procedureId: proc?.id,
        procedureSeq: proc?.seq,
        procedureName: proc?.nodeName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '领用失败');
      return;
    }
    setIssueTarget(null);
    setError('');
    setToast(`领用已登记（批号 ${issueTarget.lotNo}）`);
  };

  const openReturn = (lot: SupplyLot, issueItem: SupplyIssue) => {
    setReturnTarget({ lot, issue: issueItem });
    setReturnQty(issueOutstandingQty(issueItem));
    setReturnOperator('');
    setReturnReason('');
    setError('');
  };

  const submitReturn = async () => {
    if (!returnTarget) return;
    const outstanding = issueOutstandingQty(returnTarget.issue);
    if (returnQty <= 0 || returnQty > outstanding) {
      setError(`退回数量需在 1 ~ ${outstanding} ${returnTarget.lot.unit} 之间`);
      return;
    }
    try {
      await returnIssue(
        returnTarget.lot.id,
        returnTarget.issue.id,
        returnQty,
        returnOperator.trim() || returnTarget.issue.operator,
        returnReason,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '退回失败');
      return;
    }
    const lotNo = returnTarget.lot.lotNo;
    setReturnTarget(null);
    setError('');
    setToast(`已按批号 ${lotNo} 退回入库 ${returnQty} ${returnTarget.lot.unit}`);
  };

  const lowCount = lots.filter(isLowStock).length;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <Typography variant="h5" fontWeight={700}>
          工具材料台账
        </Typography>
        <Chip size="small" label={`共 ${lots.length} 个批次`} />
        <Chip size="small" color={lowCount > 0 ? 'warning' : 'default'} label={`低量 ${lowCount} 项`} />
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          登记批次
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} useFlexGap>
          <TextField
            size="small"
            label="批号 / 名称追溯"
            value={trace}
            onChange={(e) => setTrace(e.target.value)}
            sx={{ minWidth: 240 }}
            helperText="输入批号片段，点「台账」查看该批次的全部领用、退回、作废记录"
          />
          <TextField
            select
            size="small"
            label="种类"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as SupplyKind | 'all')}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="all">全部</MenuItem>
            {SUPPLY_KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </TextField>
          <Button onClick={() => { setTrace(''); setKindFilter('all'); }}>重置</Button>
        </Stack>
      </Paper>

      {grouped.map((group) => (
        <Paper key={group.kind} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {group.kind}
            </Typography>
            <Chip size="small" label={`${group.rows.length} 个批次`} />
          </Stack>
          {group.rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              该种类下暂无批次。
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>名称</TableCell>
                  <TableCell>规格</TableCell>
                  <TableCell>批号</TableCell>
                  <TableCell align="right">在库</TableCell>
                  <TableCell align="right">低量阈值</TableCell>
                  <TableCell align="right">剩余保质期</TableCell>
                  <TableCell>领用 / 退回 / 作废</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {group.rows.map((lot) => {
                  const low = isLowStock(lot);
                  const left = shelfLifeLeftDays(lot);
                  const sum = summarizeLot(lot);
                  return (
                    <TableRow
                      key={lot.id}
                      hover
                      data-testid={`supply-row-${lot.lotNo}`}
                      sx={low ? { bgcolor: 'warning.light' } : undefined}
                    >
                      <TableCell>
                        {lot.name}
                        {low ? <Chip size="small" color="warning" label="低量" sx={{ ml: 1 }} /> : null}
                      </TableCell>
                      <TableCell>{lot.spec}</TableCell>
                      <TableCell>{lot.lotNo}</TableCell>
                      <TableCell align="right">
                        {lot.qty} {lot.unit}
                      </TableCell>
                      <TableCell align="right">{lot.lowThreshold}</TableCell>
                      <TableCell align="right">
                        {left < 0 ? <Chip size="small" color="error" label={`已过期 ${-left} 天`} /> : `${left} 天`}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <Chip size="small" color="primary" variant="outlined" label={`领 ${sum.issuedQty}`} />
                          <Chip size="small" color="success" variant="outlined" label={`退 ${sum.returnedQty}`} />
                          <Chip size="small" color="error" variant="outlined" label={`废 ${sum.voidedQty}`} />
                          {sum.outstandingQty > 0 ? (
                            <Chip size="small" label={`在外 ${sum.outstandingQty}`} />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Button
                            size="small"
                            startIcon={<ReceiptLongIcon />}
                            onClick={() => {
                              setLedgerLot(lot);
                              setError('');
                            }}
                          >
                            台账
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={lot.qty <= 0}
                            onClick={() => openIssue(lot)}
                          >
                            领用
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Paper>
      ))}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>登记材料批次</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              size="small"
              label="名称"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField
                select
                size="small"
                fullWidth
                label="种类"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as SupplyKind })}
              >
                {SUPPLY_KINDS.map((k) => (
                  <MenuItem key={k} value={k}>
                    {k}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                fullWidth
                label="规格"
                value={draft.spec}
                onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <TextField
                size="small"
                fullWidth
                label="批号"
                required
                value={draft.lotNo}
                onChange={(e) => setDraft({ ...draft, lotNo: e.target.value })}
              />
              <TextField
                size="small"
                fullWidth
                label="单位"
                value={draft.unit}
                onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <Box sx={{ flex: 1 }}>
                <MeasureField
                  label="在库数量"
                  unit={draft.unit}
                  min={0}
                  max={100000}
                  step={1}
                  value={draft.qty}
                  onChange={(v) => setDraft({ ...draft, qty: v })}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <MeasureField
                  label="低量阈值"
                  unit={draft.unit}
                  min={0}
                  max={1000}
                  step={1}
                  value={draft.lowThreshold}
                  onChange={(v) => setDraft({ ...draft, lowThreshold: v })}
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <MeasureField
                  label="保质期"
                  unit="月"
                  min={1}
                  max={240}
                  step={1}
                  value={draft.shelfLifeMonths}
                  onChange={(v) => setDraft({ ...draft, shelfLifeMonths: v })}
                />
              </Box>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="contained" onClick={submitLot}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!issueTarget} onClose={() => setIssueTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          领用登记{issueTarget ? ` · ${issueTarget.name}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {issueTarget ? (
              <Typography variant="body2" color="text.secondary">
                批号 {issueTarget.lotNo} · 现存 {issueTarget.qty} {issueTarget.unit}
              </Typography>
            ) : null}
            <MeasureField
              label="领用数量"
              unit={issueTarget?.unit ?? '件'}
              min={1}
              max={issueTarget?.qty ?? 1}
              step={1}
              value={issueQty}
              onChange={setIssueQty}
            />
            <TextField
              size="small"
              label="领用人"
              required
              value={issueOperator}
              onChange={(e) => setIssueOperator(e.target.value)}
            />
            <TextField
              select
              size="small"
              label="用于标本"
              required
              value={issueSpecimenId}
              onChange={(e) => {
                setIssueSpecimenId(e.target.value);
                setIssueProcedureId('');
              }}
              helperText="领用必须关联标本，材料去向随标本留痕"
            >
              {specimens.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.specimenNo}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="关联工序节点"
              value={issueProcedureId}
              onChange={(e) => setIssueProcedureId(e.target.value)}
              helperText="关联后，工序回退或被移除时未退回的领用将自动作废并恢复库存；不选则仅随标本留痕"
            >
              <MenuItem value="">不关联具体工序</MenuItem>
              {procedureOptions.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  #{p.seq} {p.stepType} · {p.nodeName}
                  {p.state === 'rolledback' ? '（已回退）' : p.state === 'done' ? '（已完成）' : '（待办）'}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssueTarget(null)}>取消</Button>
          <Button variant="contained" onClick={submitIssue}>
            确认领用
          </Button>
        </DialogActions>
      </Dialog>

      {/* 批号台账：按批号汇总领用、退回、作废，逐笔保留去向 */}
      <Dialog
        open={!!ledgerLotLive}
        onClose={() => setLedgerLot(null)}
        fullWidth
        maxWidth="md"
        data-testid="lot-ledger-dialog"
      >
        <DialogTitle>
          材料台账 · {ledgerLotLive?.name}（批号 {ledgerLotLive?.lotNo}）
        </DialogTitle>
        <DialogContent dividers>
          {ledgerLotLive ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                <Chip label={`在库 ${ledgerLotLive.qty} ${ledgerLotLive.unit}`} />
                <Chip color="primary" label={`累计领用 ${summarizeLot(ledgerLotLive).issuedQty} ${ledgerLotLive.unit}`} />
                <Chip color="success" label={`累计退回 ${summarizeLot(ledgerLotLive).returnedQty} ${ledgerLotLive.unit}`} />
                <Chip color="error" label={`累计作废 ${summarizeLot(ledgerLotLive).voidedQty} ${ledgerLotLive.unit}`} />
                <Chip
                  variant="outlined"
                  label={`在外未结 ${summarizeLot(ledgerLotLive).outstandingQty} ${ledgerLotLive.unit}`}
                />
              </Stack>
              {ledgerLotLive.issues.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  该批次尚无领用记录。
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {[...ledgerLotLive.issues]
                    .sort((a, b) => b.issuedAt - a.issuedAt)
                    .map((iss) => {
                      const returned = issueReturnedQty(iss);
                      const outstanding = issueOutstandingQty(iss);
                      return (
                        <Paper key={iss.id} variant="outlined" sx={{ p: 1.5 }} data-testid={`ledger-issue-${iss.id}`}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip size="small" color={STATUS_COLOR[iss.status]} label={ISSUE_STATUS_LABEL[iss.status]} />
                            <Typography variant="body2" fontWeight={700}>
                              领 {iss.qty} {iss.unit}
                              {returned > 0 ? ` · 已退 ${returned} ${iss.unit}` : ''}
                              {iss.status === 'voided'
                                ? ` · 作废恢复 ${iss.qty - returned} ${iss.unit}`
                                : outstanding > 0
                                  ? ` · 在外 ${outstanding} ${iss.unit}`
                                  : ''}
                            </Typography>
                            <Box sx={{ flex: 1 }} />
                            {iss.status === 'issued' ? (
                              <Button
                                size="small"
                                color="success"
                                startIcon={<UndoIcon />}
                                onClick={() => openReturn(ledgerLotLive, iss)}
                              >
                                退回入库
                              </Button>
                            ) : null}
                          </Stack>
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                            {fmtTime(iss.issuedAt)} · {iss.operator} → 标本 {iss.specimenNo}
                            {iss.procedureSeq !== undefined
                              ? ` · 工序 #${iss.procedureSeq} ${iss.procedureName ?? ''}`
                              : '（未关联工序）'}
                          </Typography>
                          {iss.status === 'voided' ? (
                            <Typography variant="caption" display="block" color="error.main">
                              作废时间 {fmtTime(iss.voidedAt)} · {iss.voidReason ?? '库存已恢复'}
                            </Typography>
                          ) : null}
                          {iss.returns.length > 0 ? (
                            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                              {iss.returns.map((r) => (
                                <Box key={r.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <Chip size="small" color="success" variant="outlined" label="退回" />
                                  <Typography variant="caption">
                                    {fmtTime(r.returnedAt)} · {r.operator} 退回 {r.qty} {iss.unit} 入本批次
                                    {r.reason ? `（${r.reason}）` : ''}
                                  </Typography>
                                </Box>
                              ))}
                            </Stack>
                          ) : null}
                        </Paper>
                      );
                    })}
                </Stack>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLedgerLot(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        fullWidth
        maxWidth="xs"
        data-testid="return-dialog"
      >
        <DialogTitle>退回入库</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {returnTarget ? (
              <Typography variant="body2" color="text.secondary">
                批号 {returnTarget.lot.lotNo} · 原领用 {returnTarget.issue.qty} {returnTarget.lot.unit}
                {' '}· 在外未退 {issueOutstandingQty(returnTarget.issue)} {returnTarget.lot.unit}
              </Typography>
            ) : null}
            <MeasureField
              label="退回数量"
              unit={returnTarget?.lot.unit ?? '件'}
              min={1}
              max={returnTarget ? issueOutstandingQty(returnTarget.issue) : 1}
              step={1}
              value={returnQty}
              onChange={setReturnQty}
              hint="退回按原批号增加库存，可分多次退回"
            />
            <TextField
              size="small"
              label="退回人"
              value={returnOperator}
              onChange={(e) => setReturnOperator(e.target.value)}
              placeholder={returnTarget?.issue.operator}
            />
            <TextField
              size="small"
              label="退回说明"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="如：胶种未用完，退回原批次"
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReturnTarget(null)}>取消</Button>
          <Button variant="contained" color="success" onClick={submitReturn}>
            确认退回
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2400} onClose={() => setToast('')} message={toast} />
    </Stack>
  );
}
