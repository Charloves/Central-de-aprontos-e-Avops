import { buildImportReport, parseAvops, parseEfetivo, parseLeituras, readRowsFromFile } from '../src/lib/importers/index.ts';

type ImportArgs = {
  efetivo?: string;
  avops?: string;
  leituras?: string;
  redact?: boolean;
};

const args = parseArgs(process.argv.slice(2));
const sheets = [];

if (args.efetivo) {
  const { rows } = readRowsFromFile(args.efetivo);
  sheets.push(parseEfetivo(rows));
}

if (args.avops) {
  const { rows } = readRowsFromFile(args.avops);
  sheets.push(parseAvops(rows));
}

if (args.leituras) {
  const { rows } = readRowsFromFile(args.leituras);
  sheets.push(parseLeituras(rows));
}

if (!sheets.length) {
  throw new Error('Informe pelo menos um arquivo: --efetivo, --avops ou --leituras.');
}

const report = buildImportReport(sheets, new Date().toISOString(), { redact: args.redact });
console.log(JSON.stringify(report, null, 2));

function parseArgs(values: string[]): ImportArgs {
  const out: ImportArgs = {};

  for (let i = 0; i < values.length; i += 1) {
    const key = values[i];
    const value = values[i + 1];

    if (key === '--redact') {
      out.redact = true;
      continue;
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Argumento sem valor: ${key}`);
    }

    if (key === '--efetivo') out.efetivo = value;
    else if (key === '--avops') out.avops = value;
    else if (key === '--leituras') out.leituras = value;
    else throw new Error(`Argumento desconhecido: ${key}`);

    i += 1;
  }

  return out;
}
