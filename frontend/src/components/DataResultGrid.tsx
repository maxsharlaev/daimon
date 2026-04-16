import { useCallback, useEffect, useState } from "react";

export type GridSortState = { column: string | null; dir: "asc" | "desc" | null };

type SortableTableProps = {
  className?: string;
  columns: string[];
  rows: string[][];
  sort: GridSortState;
  onSortClick: (column: string) => void;
  emptyMessage?: string;
  onRowClick?: (row: string[]) => void;
};

export function DataSortableTable({
  className = "data-grid",
  columns,
  rows,
  sort,
  onSortClick,
  emptyMessage = "No rows.",
  onRowClick,
}: SortableTableProps) {
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c}>
              <button
                type="button"
                className="data-grid-th-sort"
                onClick={() => onSortClick(c)}
                title="Sort: ascending → descending → off"
              >
                <span className="data-grid-th-sort-label">{c}</span>
                {sort.column === c && sort.dir === "asc" ? (
                  <span className="data-grid-th-sort-ind" aria-hidden>
                    ▲
                  </span>
                ) : sort.column === c && sort.dir === "desc" ? (
                  <span className="data-grid-th-sort-ind" aria-hidden>
                    ▼
                  </span>
                ) : null}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={Math.max(1, columns.length)} className="data-grid-empty-cell">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row, ri) => (
            <tr
              key={ri}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "data-row-click" : undefined}
            >
              {(row ?? []).map((cell, ci) => (
                <td key={ci} title={cell}>
                  <span className="data-cell-clip">{cell}</span>
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

type PaginationFooterProps = {
  page: number;
  pageSize: number;
  /** Full result size (e.g. server COUNT), shown in “N rows”. */
  totalRows: number;
  /** Row count used only for page count / jump max (e.g. loaded rows). Defaults to totalRows. */
  paginationRowCount?: number;
  /** When set and totalRows is larger, meta shows “(N loaded)”. */
  loadedRowCount?: number;
  onPageChange: (page: number) => void;
  paginationDisabled?: boolean;
};

export function DataGridPaginationFooter({
  page,
  pageSize,
  totalRows,
  paginationRowCount,
  loadedRowCount,
  onPageChange,
  paginationDisabled,
}: PaginationFooterProps) {
  const basis = paginationRowCount ?? totalRows;
  const totalPages = Math.max(1, Math.ceil(basis / pageSize) || 1);
  const [jumpInput, setJumpInput] = useState(String(page));

  useEffect(() => {
    setJumpInput(String(page));
  }, [page]);

  const commitJump = useCallback(() => {
    let n = parseInt(jumpInput.trim(), 10);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > totalPages) n = totalPages;
    onPageChange(n);
    setJumpInput(String(n));
  }, [jumpInput, onPageChange, totalPages]);

  const showLoaded =
    loadedRowCount != null && totalRows > loadedRowCount;

  return (
    <div className="data-preview-pagination">
      <span className="data-preview-pagination-meta mono">
        {totalRows.toLocaleString()} rows
        {showLoaded ? ` (${(loadedRowCount ?? 0).toLocaleString()} loaded)` : ""} · page {page} / {totalPages}
      </span>
      <div className="data-preview-pagination-controls">
        <button
          type="button"
          className="btn"
          disabled={page <= 1 || paginationDisabled}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Prev
        </button>
        <label className="data-preview-page-jump">
          <span className="data-preview-page-jump-label">Page</span>
          <input
            type="text"
            inputMode="numeric"
            className="data-preview-page-input mono"
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onBlur={() => void commitJump()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitJump();
              }
            }}
            aria-label="Page number"
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={page >= totalPages || paginationDisabled}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Client-side sort of tabular string rows by column index (locale-aware, numeric). */
export function sortDataRowsByColumn(rows: string[][], columnNames: string[], sort: GridSortState): string[][] {
  if (!sort.column || !sort.dir) return rows.slice();
  const ci = columnNames.indexOf(sort.column);
  if (ci < 0) return rows.slice();
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((ra, rb) => {
    const a = ra[ci] ?? "";
    const b = rb[ci] ?? "";
    const n = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    return n * mul;
  });
}
