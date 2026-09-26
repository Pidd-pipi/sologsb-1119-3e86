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
import { useSupplyStore } from '../stores/supplyStore';
import { useSpecimenStore } from '../stores/specimenStore';
import { useProcedureStore } from '../stores/procedureStore';
import { MeasureField } from '../components/common/MeasureField';
import {
  SUPPLY_KINDS,
  ISSUE_STATUS_LABEL,
  isLowStock,
  issueOutstanding,
  issueStatus,
  lotLedger,
  shelfLifeLeftDays,
  type SupplyIssue,
  type SupplyKind,
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

/** 单笔领用的分段去向：在用 / 退回 / 作废 */
function issueTrailText(issue: SupplyIssue, unit: string): string {
  const parts: string[] = [];
  const outstanding = issueOutstanding(issue);
  if (outstanding > 0) parts.push(`在用 ${outstanding} ${unit}`);
  if (issue.returnedQty > 0) parts.push(`退 ${issue.returnedQty}`);
  if (issue.voidedQty > 0) parts.push(`废 ${issue.voidedQty}${issue.voidReason ? `（${issue.voidReason}）` : ''}`);
  return parts.join(' · ');
}

/** /supplies 工具材料台账：按种类分组、批号追溯、领/退/废汇总、低量行高亮 */
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
  const [detailLotId, setDetailLotId] = useState<string | null>(null);
  const [returnCtx, setReturnCtx] = useState<{ lotId: string; issueId: string } | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returnNote, setReturnNote] = useState('');
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

  /** 流水弹窗与退回弹窗按 id 取最新数据，避免操作后展示旧快照 */
  const detailLot = useMemo(
    () => (detailLotId ? (lots.find((it) => it.id === detailLotId) ?? null) : null),
    [lots, detailLotId],
  );
  const detailLedger = detailLot ? lotLedger(detailLot) : null;

  const returnLot = useMemo(
    () => (returnCtx ? (lots.find((it) => it.id === returnCtx.lotId) ?? null) : null),
    [lots, returnCtx],
  );
  const returnIssueRow = useMemo(
    () => returnLot?.issues.find((it) => it.id === returnCtx?.issueId) ?? null,
    [returnLot, returnCtx],
  );
  const returnOutstanding = returnIssueRow ? issueOutstanding(returnIssueRow) : 0;

  /** 领用弹窗中按所选标本过滤工序节点 */
  const issueProcedures = useMemo(() => {
    if (!issueSpecimenId) return [];
    return procedures
      .filter((it) => it.specimenId === issueSpecimenId)
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
    const specimen = specimens.find((it) => it.id === issueSpecimenId);
    const procedure = procedures.find((it) => it.id === issueProcedureId);
    await issue(issueTarget.id, {
      qty: issueQty,
      operator: issueOperator.trim(),
      specimenNo: specimen?.specimenNo ?? '未关联标本',
      specimenId: specimen?.id,
      procedureId: procedure?.id,
      procedureLabel: procedure ? `#${procedure.seq} ${procedure.stepType} · ${procedure.nodeName}` : undefined,
    });
    setIssueTarget(null);
    setIssueQty(1);
    setIssueOperator('');
    setIssueSpecimenId('');
    setIssueProcedureId('');
    setError('');
    setToast('领用已登记');
  };

  const submitReturn = async () => {
    if (!returnCtx || !returnLot || !returnIssueRow) return;
    if (returnQty <= 0 || returnQty > returnOutstanding) {
      setError(`退回数量需在 1 ~ ${returnOutstanding} ${returnLot.unit} 之间`);
      return;
    }
    await returnIssue(returnCtx.lotId, returnCtx.issueId, returnQty, returnNote);
    setReturnCtx(null);
    setReturnQty(1);
    setReturnNote('');
    setError('');
    setToast(`已退回 ${returnQty} ${returnLot.unit}，库存已回库`);
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
            helperText="输入批号片段可定位该批次，点「流水」查看领用 / 退回 / 作废明细"
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
                  <TableCell>领 / 退 / 废</TableCell>
                  <TableCell align="right">低量阈值</TableCell>
                  <TableCell align="right">剩余保质期</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {group.rows.map((lot) => {
                  const low = isLowStock(lot);
                  const left = shelfLifeLeftDays(lot);
                  const ledger = lotLedger(lot);
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
                        {ledger.outstanding > 0 ? (
                          <Typography variant="caption" display="block" color="text.secondary">
                            在用 {ledger.outstanding} {lot.unit}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" component="span">
                          领 {ledger.issued}
                        </Typography>
                        {' · '}
                        <Typography
                          variant="body2"
                          component="span"
                          color={ledger.returned > 0 ? 'success.main' : 'text.secondary'}
                        >
                          退 {ledger.returned}
                        </Typography>
                        {' · '}
                        <Typography
                          variant="body2"
                          component="span"
                          color={ledger.voided > 0 ? 'error.main' : 'text.secondary'}
                        >
                          废 {ledger.voided}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{lot.lowThreshold}</TableCell>
                      <TableCell align="right">
                        {left < 0 ? <Chip size="small" color="error" label={`已过期 ${-left} 天`} /> : `${left} 天`}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          <Button
                            size="small"
                            disabled={lot.qty <= 0}
                            onClick={() => {
                              setIssueTarget(lot);
                              setIssueQty(1);
                              setIssueSpecimenId('');
                              setIssueProcedureId('');
                              setError('');
                            }}
                          >
                            领用
                          </Button>
                          <Button size="small" disabled={lot.issues.length === 0} onClick={() => setDetailLotId(lot.id)}>
                            流水
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
              value={issueSpecimenId}
              onChange={(e) => {
                setIssueSpecimenId(e.target.value);
                setIssueProcedureId('');
              }}
            >
              <MenuItem value="">未关联标本</MenuItem>
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
              disabled={!issueSpecimenId}
              onChange={(e) => setIssueProcedureId(e.target.value)}
              helperText={issueSpecimenId ? '工序回退或移除时，未退回的领用将自动作废回库' : '先选择标本再关联工序'}
            >
              <MenuItem value="">不关联工序</MenuItem>
              {issueProcedures.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  #{p.seq} {p.stepType} · {p.nodeName}
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

      <Dialog open={!!detailLot} onClose={() => setDetailLotId(null)} fullWidth maxWidth="md">
        <DialogTitle>
          批次流水{detailLot ? ` · ${detailLot.name}（批号 ${detailLot.lotNo}）` : ''}
        </DialogTitle>
        <DialogContent dividers>
          {detailLot && detailLedger ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" variant="outlined" label={`在库 ${detailLot.qty} ${detailLot.unit}`} />
                <Chip size="small" label={`累计领用 ${detailLedger.issued}`} />
                <Chip
                  size="small"
                  color={detailLedger.returned > 0 ? 'success' : 'default'}
                  variant={detailLedger.returned > 0 ? 'filled' : 'outlined'}
                  label={`已退回 ${detailLedger.returned}`}
                />
                <Chip
                  size="small"
                  color={detailLedger.voided > 0 ? 'error' : 'default'}
                  variant={detailLedger.voided > 0 ? 'filled' : 'outlined'}
                  label={`已作废 ${detailLedger.voided}`}
                />
                <Chip size="small" color="primary" variant="outlined" label={`在用 ${detailLedger.outstanding}`} />
              </Stack>
              {detailLot.issues.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  该批次暂无领用记录。
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>领用时间</TableCell>
                      <TableCell>领用人</TableCell>
                      <TableCell align="right">数量</TableCell>
                      <TableCell>去向（标本 / 工序）</TableCell>
                      <TableCell>状态</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detailLot.issues.map((iss) => {
                      const status = issueStatus(iss);
                      const outstanding = issueOutstanding(iss);
                      return (
                        <TableRow key={iss.id} hover>
                          <TableCell>{fmtTime(iss.issuedAt)}</TableCell>
                          <TableCell>{iss.operator}</TableCell>
                          <TableCell align="right">
                            {iss.qty} {detailLot.unit}
                          </TableCell>
                          <TableCell>
                            {iss.specimenNo}
                            {iss.procedureLabel ? (
                              <Typography variant="caption" display="block" color="text.secondary">
                                {iss.procedureLabel}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={ISSUE_STATUS_LABEL[status]}
                              color={status === 'voided' ? 'error' : status === 'returned' ? 'success' : 'primary'}
                              variant={status === 'issued' ? 'outlined' : 'filled'}
                            />
                            <Typography variant="caption" display="block" color="text.secondary">
                              {issueTrailText(iss, detailLot.unit)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              disabled={outstanding <= 0}
                              onClick={() => {
                                setReturnCtx({ lotId: detailLot.id, issueId: iss.id });
                                setReturnQty(outstanding);
                                setReturnNote('');
                                setError('');
                              }}
                            >
                              退回
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailLotId(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!returnCtx && !!returnIssueRow} onClose={() => setReturnCtx(null)} fullWidth maxWidth="xs">
        <DialogTitle>退回登记{returnLot ? ` · ${returnLot.name}` : ''}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {returnLot && returnIssueRow ? (
              <Typography variant="body2" color="text.secondary">
                批号 {returnLot.lotNo} · 该笔在用 {returnOutstanding} {returnLot.unit}，退回后回到原批次库存
              </Typography>
            ) : null}
            <MeasureField
              label="退回数量"
              unit={returnLot?.unit ?? '件'}
              min={1}
              max={Math.max(1, returnOutstanding)}
              step={1}
              value={returnQty}
              onChange={setReturnQty}
            />
            <TextField
              size="small"
              label="退回备注（去向说明）"
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              placeholder="如：胶种未用完，退回原批次"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReturnCtx(null)}>取消</Button>
          <Button variant="contained" onClick={submitReturn}>
            确认退回
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={2400} onClose={() => setToast('')} message={toast} />
    </Stack>
  );
}
