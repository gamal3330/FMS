type PaginationProps = {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

export function Pagination({ page, totalItems, pageSize, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const pages = visiblePages(page, totalPages);
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 p-4 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-emerald-900/40" dir="rtl">
      <p className="text-slate-500 dark:text-slate-300">
        عرض {firstItem} - {lastItem} من {totalItems}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="h-9 rounded-md border border-slate-300 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/50 dark:bg-[#0b1f19] dark:text-slate-100 dark:hover:bg-emerald-950/40"
        >
          السابق
        </button>
        {pages.map((item, index) =>
          item === "..." ? (
            <span key={`${item}-${index}`} className="px-2 text-slate-400 dark:text-slate-500">...</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={`h-9 min-w-9 rounded-md border px-3 font-bold ${
                item === page
                  ? "border-bank-600 bg-bank-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-emerald-900/50 dark:bg-[#0b1f19] dark:text-slate-100 dark:hover:bg-emerald-950/40"
              }`}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="h-9 rounded-md border border-slate-300 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/50 dark:bg-[#0b1f19] dark:text-slate-100 dark:hover:bg-emerald-950/40"
        >
          التالي
        </button>
      </div>
    </div>
  );
}

function visiblePages(current: number, total: number): Array<number | "..."> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(pages).filter((item) => item >= 1 && item <= total).sort((a, b) => a - b);
  const result: Array<number | "..."> = [];
  for (const item of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && item - previous > 1) {
      result.push("...");
    }
    result.push(item);
  }
  return result;
}
