import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parseCsv } from './csv.ts';
import type { RawRow, SourceFormat } from './types.ts';

export function readRowsFromFile(path: string): { format: SourceFormat; rows: RawRow[] } {
  const input = readFileSync(path, 'utf8');
  const extension = extname(path).toLowerCase();

  if (extension === '.json') {
    const parsed = JSON.parse(input) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Arquivo JSON deve conter um array de objetos: ${path}`);
    }
    return { format: 'json', rows: parsed as RawRow[] };
  }

  if (extension === '.csv') {
    return { format: 'csv', rows: parseCsv(input) };
  }

  throw new Error(`Formato nao suportado para ${path}. Use .csv ou .json.`);
}
