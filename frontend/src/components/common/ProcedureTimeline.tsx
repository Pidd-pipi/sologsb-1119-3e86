import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { PrepProcedure } from '../../types/procedure';
import { issueOutstanding, type SupplyIssue, type SupplyLot } from '../../types/supply';

/** 工序节点名下的一笔材料领用（带批次信息） */
export interface ProcedureIssueEntry {
  lot: SupplyLot;
  issue: SupplyIssue;
}

export interface ProcedureTimelineProps {
  items: PrepProcedure[];
  onFinish?: (id: string) => void;
  onRollback?: (id: string) => void;
  onRemove?: (id: string) => void;
  onOpenPhoto?: (procedureId: string) => void;
  /** 按工序 id 分组的材料领用，用于在节点展开区展示去向 */
  issuesByProcedure?: Record<string, ProcedureIssueEntry[]>;
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 单笔领用的去向文案：在用 / 退回 / 作废分段列出 */
function issueTrailText(entry: ProcedureIssueEntry): string {
  const { lot, issue } = entry;
  const parts: string[] = [];
  const outstanding = issueOutstanding(issue);
  if (outstanding > 0) parts.push(`在用 ${outstanding} ${lot.unit}`);
  if (issue.returnedQty > 0) parts.push(`已退回 ${issue.returnedQty} ${lot.unit}`);
  if (issue.voidedQty > 0) {
    parts.push(`已作废 ${issue.voidedQty} ${lot.unit}${issue.voidReason ? `（${issue.voidReason}）` : ''}`);
  }
  return parts.join(' · ') || '—';
}

/**
 * 纵向工序节点流：步骤图标、状态、耗时、环境参数与材料领用折叠区。
 * 被标本详情页、工序录入页消费。
 */
export function ProcedureTimeline({
  items,
  onFinish,
  onRollback,
  onRemove,
  onOpenPhoto,
  issuesByProcedure,
}: ProcedureTimelineProps) {
  const [expanded, setExpanded] = useState<string | null>(items[0]?.id ?? null);

  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          该标本暂无工序节点，请到「新建工序节点」登记。
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={1} data-testid="procedure-timeline">
      {items.map((node, index) => {
        const isDone = node.state === 'done';
        const open = expanded === node.id;
        const issueEntries = issuesByProcedure?.[node.id] ?? [];
        return (
          <Box key={node.id} sx={{ display: 'flex', gap: 1.5 }}>
            <Stack alignItems="center" sx={{ pt: 0.5 }}>
              {isDone ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : (
                <RadioButtonUncheckedIcon color={node.state === 'rolledback' ? 'error' : 'disabled'} fontSize="small" />
              )}
              {index < items.length - 1 ? (
                <Box sx={{ flex: 1, width: '2px', minHeight: 32, bgcolor: 'divider', my: 0.5 }} />
              ) : null}
            </Stack>
            <Paper variant="outlined" sx={{ p: 1.5, flex: 1, mb: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" label={`#${node.seq}`} color="primary" variant="outlined" />
                <Typography variant="subtitle2" fontWeight={700}>
                  {node.stepType} · {node.nodeName}
                </Typography>
                <Chip
                  size="small"
                  label={node.state === 'done' ? '已完成' : node.state === 'rolledback' ? '已回退' : '待办'}
                  color={isDone ? 'success' : node.state === 'rolledback' ? 'error' : 'default'}
                />
                <Typography variant="caption" color="text.secondary">
                  耗时 {node.durationMin} min · 责任人 {node.operator}
                </Typography>
                {issueEntries.length > 0 ? (
                  <Chip size="small" variant="outlined" label={`材料 ${issueEntries.length} 笔`} />
                ) : null}
                <Box sx={{ flex: 1 }} />
                {!isDone && onFinish ? (
                  <Button size="small" variant="contained" onClick={() => onFinish(node.id)}>
                    完成节点
                  </Button>
                ) : null}
                {isDone && onRollback ? (
                  <Button size="small" color="warning" startIcon={<UndoIcon />} onClick={() => onRollback(node.id)}>
                    回退节点
                  </Button>
                ) : null}
                {onRemove ? (
                  <Tooltip title="移除节点（关联领用将作废回库）">
                    <IconButton size="small" color="error" onClick={() => onRemove(node.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : null}
                <Tooltip title={open ? '收起环境参数' : '展开环境参数'}>
                  <IconButton size="small" onClick={() => setExpanded(open ? null : node.id)}>
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
                    />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Collapse in={open} unmountOnExit>
                <Divider sx={{ my: 1 }} />
                <Stack direction="row" spacing={2} flexWrap="wrap" rowGap={0.5}>
                  <Typography variant="body2">工具：{node.tools.length ? node.tools.join('、') : '—'}</Typography>
                  <Typography variant="body2">磨料：{node.abrasive || '—'}</Typography>
                  <Typography variant="body2">
                    胶种：{node.adhesive || '—'}
                    {node.adhesiveConc > 0 ? `（浓度 ${node.adhesiveConc} %）` : ''}
                  </Typography>
                  <Typography variant="body2">
                    环境：{node.tempC} ℃ / RH {node.rh} %
                  </Typography>
                  <Typography variant="body2">开始：{fmtTime(node.startedAt)}</Typography>
                  <Typography variant="body2">结束：{fmtTime(node.finishedAt)}</Typography>
                  <Typography variant="body2">
                    影像：前 {node.photoBeforeIds.length} 张 / 后 {node.photoAfterIds.length} 张
                  </Typography>
                  {onOpenPhoto ? (
                    <Button size="small" onClick={() => onOpenPhoto(node.id)}>
                      查看对照
                    </Button>
                  ) : null}
                </Stack>
                {issueEntries.length > 0 ? (
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      材料领用去向
                    </Typography>
                    {issueEntries.map((entry) => (
                      <Stack key={entry.issue.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="body2">
                          {entry.lot.name}（批 {entry.lot.lotNo}）× {entry.issue.qty} {entry.lot.unit}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={entry.issue.voidedQty > 0 ? 'error' : issueOutstanding(entry.issue) === 0 ? 'success' : 'default'}
                          label={issueTrailText(entry)}
                        />
                      </Stack>
                    ))}
                  </Stack>
                ) : null}
              </Collapse>
            </Paper>
          </Box>
        );
      })}
    </Stack>
  );
}

export default ProcedureTimeline;
