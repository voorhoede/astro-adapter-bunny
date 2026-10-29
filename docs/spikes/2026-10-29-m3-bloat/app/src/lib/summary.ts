import { orderBy, sumBy, take, uniqBy } from 'lodash-es';

type Result = { name: string; label: string; value: number };

export function summarize(results: Result[]) {
  const unique = uniqBy(results, 'name');
  return {
    count: unique.length,
    total: Math.round(sumBy(unique, 'value') * 100) / 100,
    top: take(orderBy(unique, ['value'], ['desc']), 5),
  };
}
