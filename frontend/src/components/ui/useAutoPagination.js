import { useEffect, useMemo, useState } from "react";

export const DEFAULT_AUTO_PAGE_SIZE = 10;

export function useAutoPagination(rows = [], pageSize = DEFAULT_AUTO_PAGE_SIZE) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const [page, setPage] = useState(1);
  const totalItems = safeRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setPage(1);
  }, [totalItems, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const visibleRows = useMemo(() => {
    if (totalItems <= pageSize) return safeRows;
    const start = (page - 1) * pageSize;
    return safeRows.slice(start, start + pageSize);
  }, [safeRows, page, pageSize, totalItems]);

  return {
    page,
    setPage,
    pageSize,
    totalItems,
    visibleRows,
    showPagination: totalItems > pageSize
  };
}
