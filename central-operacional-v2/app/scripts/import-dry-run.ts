import {
  buildImportReport,
  parseAcessosLog,
  parseAprontos,
  parseAvops,
  parseEfetivo,
  parseEmailLog,
  parseLeituras,
  parseOiH125,
  parseOiH50,
  parsePresencas,
  readRowsFromFile,
} from '../src/lib/importers/index.ts';

type ImportArgs = {
  efetivo?: string;
  avops?: string;
  leituras?: string;
  aprontos?: string;
  presencas?: string;
  oiH50?: string;
  oiH125?: string;
  emailLog?: string;
  acessosLog?: string;
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

if (args.aprontos) {
  const { rows } = readRowsFromFile(args.aprontos);
  sheets.push(parseAprontos(rows));
}

if (args.presencas) {
  const { rows } = readRowsFromFile(args.presencas);
  sheets.push(parsePresencas(rows));
}

if (args.oiH50) {
  const { rows } = readRowsFromFile(args.oiH50);
  sheets.push(parseOiH50(rows));
}

if (args.oiH125) {
  const { rows } = readRowsFromFile(args.oiH125);
  sheets.push(parseOiH125(rows));
}

if (args.emailLog) {
  const { rows } = readRowsFromFile(args.emailLog);
  sheets.push(parseEmailLog(rows));
}

if (args.acessosLog) {
  const { rows } = readRowsFromFile(args.acessosLog);
  sheets.push(parseAcessosLog(rows));
}

if (!sheets.length) {
  throw new Error('Informe pelo menos um arquivo: --efetivo, --avops, --leituras, --aprontos, --presencas, --oi-h50, --oi-h125, --email-log ou --acessos-log.');
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
    else if (key === '--aprontos') out.aprontos = value;
    else if (key === '--presencas') out.presencas = value;
    else if (key === '--oi-h50') out.oiH50 = value;
    else if (key === '--oi-h125') out.oiH125 = value;
    else if (key === '--email-log') out.emailLog = value;
    else if (key === '--acessos-log') out.acessosLog = value;
    else throw new Error(`Argumento desconhecido: ${key}`);

    i += 1;
  }

  return out;
}
