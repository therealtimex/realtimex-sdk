import { UsageError } from "./error.js";
const aliasPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const referencePattern = /^secret:\/\/.+$/;

export function parseArguments(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  if (argv.length === 1 && argv[0] === '--version') return { version: true };
  if (argv[0] !== 'run') throw new UsageError('Use rtxexec run [bindings] -- command [arguments]. Secret management belongs to realtimex-pp-cli.');
  const separator = argv.indexOf('--');
  if (separator < 0 || !argv[separator + 1]) throw new UsageError('Specify -- followed by an executable.');
  const env = new Map(); const aliases = new Map(); let stdin;
  for (let i = 1; i < separator; i += 2) {
    const option = argv[i]; const binding = argv[i + 1];
    if (!['--env', '--secret', '--stdin'].includes(option) || i + 1 >= separator) throw new UsageError('Expected --env NAME=secret://name, --secret alias=secret://name, or --stdin secret://name.');
    if (option === '--stdin') {
      if (stdin || !referencePattern.test(binding)) throw new UsageError('Supply one secret reference for --stdin.');
      stdin = binding; continue;
    }
    const equals = binding.indexOf('=');
    const name = binding.slice(0, equals); const reference = binding.slice(equals + 1);
    const target = option === '--env' ? env : aliases;
    if (equals < 1 || !aliasPattern.test(name) || !referencePattern.test(reference) || target.has(name)) throw new UsageError('Invalid or duplicate secret binding.');
    target.set(name, reference);
  }
  const references = [...new Set([...env.values(), ...aliases.values(), ...(stdin ? [stdin] : [])])];
  if (!references.length || references.length > 32 || references.some((ref) => ref.length > 1024)) throw new UsageError('Bind between 1 and 32 secrets.');
  const command = argv[separator + 1]; const args = argv.slice(separator + 2);
  if (command.includes('{{') || command.includes('\0')) throw new UsageError('The executable cannot contain a secret placeholder.');
  for (const arg of args) for (const match of arg.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) {
    if (!aliases.has(match[1])) throw new UsageError('An argument uses an undeclared secret placeholder.');
  }
  return { command, args, env, aliases, stdin, references };
}

export function inject(plan, secrets, environment) {
  const values = new Map(secrets.map(({ reference, value }) => [reference, value]));
  for (const reference of plan.references) {
    const value = values.get(reference);
    if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value) > 65536) throw new UsageError('The app returned an invalid or missing secret value.');
  }
  const env = { ...environment };
  for (const [name, reference] of plan.env) env[name] = values.get(reference);
  const args = plan.args.map((arg) => arg.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, name) => values.get(plan.aliases.get(name))));
  return { args, env, stdin: plan.stdin ? values.get(plan.stdin) : undefined, values: [...values.values()] };
}
