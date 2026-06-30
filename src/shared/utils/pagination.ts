export type PaginationInput = {
  page?: number;
  limit?: number;
};

export function normalizePagination(input: PaginationInput) {
  const page = Math.max(input.page ?? 1, 1);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}
