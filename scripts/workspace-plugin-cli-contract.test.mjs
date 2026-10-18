import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WORKSPACE_PLUGIN_HELPER_FILE,
  patchWorkspacePluginCommands,
} from './workspace-plugin-cli-contract.mjs';

// The anchors Printing Press v4.20.1 renders for the four commands.
const GENERATED = {
  'list-workspace-plugins': `func newListWorkspacePluginsPromotedCmd(flags *rootFlags) *cobra.Command {
	var flagWorkspaceSlug string
			c, err := flags.newClient()
			if err != nil {
				return err
			}
			data, prov, err := resolveReadWithStrategy(cmd.Context(), c, flags, "auto", "list-workspace-plugins", false, path, params, nil, cmd.ErrOrStderr())
}`,
  'get-workspace-plugin': `func newGetWorkspacePluginPromotedCmd(flags *rootFlags) *cobra.Command {
	var flagWorkspaceSlug string
			c, err := flags.newClient()
			if err != nil {
				return err
			}
			data, prov, err := resolveReadWithStrategy(cmd.Context(), c, flags, "auto", "get-workspace-plugin", false, path, params, nil, cmd.ErrOrStderr())
}`,
  'set-workspace-plugin': `func newSetWorkspacePluginPromotedCmd(flags *rootFlags) *cobra.Command {
	var flagWorkspaceSlug string
	var bodyConfig string
	var bodyEnabled bool
		Example:     "  realtimex-pp-cli set-workspace-plugin 550e8400-e29b-41d4-a716-446655440000 --workspace-slug example-value",
			c, err := flags.newClient()
			body := map[string]any{}
			if bodyConfig != "" {
				var parsedConfig any
				if err := json.Unmarshal([]byte(bodyConfig), &parsedConfig); err != nil {
					return fmt.Errorf("parsing --config JSON: %w", err)
				}
				body["config"] = parsedConfig
			}
			if cmd.Flags().Changed("enabled") {
				body["enabled"] = bodyEnabled
			}
	cmd.Flags().StringVar(&bodyConfig, "config", "", "Partial update of non-secret workspace settings.")
	cmd.Flags().BoolVar(&bodyEnabled, "enabled", false, "true turns the plugin on.")
}`,
  'reset-workspace-plugin': `func newResetWorkspacePluginPromotedCmd(flags *rootFlags) *cobra.Command {
	var flagWorkspaceSlug string
	var flagYes string
		Example:     "  realtimex-pp-cli reset-workspace-plugin 550e8400-e29b-41d4-a716-446655440000 --workspace-slug example-value --yes true",
			if !cmd.Flags().Changed("yes") && !flags.dryRun {
				return fmt.Errorf("required flag \\"%s\\" not set", "yes")
			}
			c, err := flags.newClient()
			if flagYes != "" {
				params["yes"] = fmt.Sprintf("%v", flagYes)
			}
	cmd.Flags().StringVar(&flagYes, "yes", "", "Required true.")
}`,
};

// The retry policy anchors in the generated client.
const GENERATED_CLIENT = `package client

func (c *Client) doInternal(ctx context.Context, method, path string, params map[string]string, body any, headerOverrides map[string]string, readOnlyIntent bool) (json.RawMessage, int, error) {
\tconst maxRetries = 3
\tfor attempt := 0; attempt <= maxRetries; attempt++ {
\t}
}
`;

function generatedTree(commands = Object.keys(GENERATED)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-plugin-contract-'));
  const dir = path.join(root, 'internal/cli');
  fs.mkdirSync(dir, { recursive: true });
  for (const command of commands) {
    fs.writeFileSync(path.join(dir, `promoted_${command}.go`), GENERATED[command]);
  }
  const clientFile = path.join(root, 'internal/client/client.go');
  fs.mkdirSync(path.dirname(clientFile), { recursive: true });
  fs.writeFileSync(clientFile, GENERATED_CLIENT);
  return {
    root,
    dir,
    read: (command) => fs.readFileSync(path.join(dir, `promoted_${command}.go`), 'utf8'),
    client: () => fs.readFileSync(clientFile, 'utf8'),
  };
}

test('patches set and reset into the workspace plugin command contract', () => {
  const tree = generatedTree();
  try {
    assert.equal(patchWorkspacePluginCommands(tree.root), 4);
    const set = tree.read('set-workspace-plugin');
    assert.match(set, /StringArrayVar\(&bodyConfig, "config", nil,/);
    assert.match(set, /StringVar\(&bodyConfigJSON, "config-json", "",/);
    assert.match(set, /StringVar\(&bodyEnabled, "enabled", "",/);
    assert.ok(!set.includes('BoolVar(&bodyEnabled'));
    assert.ok(!set.includes('parsedConfig'));
    assert.ok(set.includes('body["enabled"] = *workspacePluginEnabled'));
    assert.ok(set.indexOf('workspacePluginConfigBody(') < set.indexOf('c, err := flags.newClient()'));
    const reset = tree.read('reset-workspace-plugin');
    assert.ok(reset.includes('var flagYes bool'));
    assert.match(reset, /BoolVar\(&flagYes, "yes", false,/);
    assert.ok(reset.includes('params["yes"] = "true"'));
    assert.ok(!reset.includes('flags.dryRun {\n\t\t\t\treturn fmt.Errorf("required flag'));
    assert.ok(reset.indexOf('if !flagYes {') < reset.indexOf('c, err := flags.newClient()'));
    for (const command of ['list-workspace-plugins', 'get-workspace-plugin']) {
      const read = tree.read(command);
      assert.match(read, /if len\(args\) > [01] \{/);
      assert.match(read, /return err\n\t\t\t\}\n\t\t\tc\.NoCache = true\n/);
      assert.match(read, new RegExp(`resolveReadWithStrategy\\(cmd\\.Context\\(\\), c, flags, "live", "${command}"`));
      assert.ok(!read.includes('"auto"'));
    }
    assert.ok(fs.existsSync(path.join(tree.dir, WORKSPACE_PLUGIN_HELPER_FILE)));
    const client = tree.client();
    assert.match(client, /func isWorkspacePluginMutationPath\(method, path string\) bool/);
    assert.match(client, /"\/set-workspace-plugin\/"/);
    assert.match(client, /"\/reset-workspace-plugin\/"/);
    assert.match(client, /\tmaxRetries := 3\n\tif !readOnlyIntent && isWorkspacePluginMutationPath\(method, path\) \{\n\t\tmaxRetries = 0\n\t\}/);
    assert.ok(!client.includes('const maxRetries'));

    const once = [...Object.keys(GENERATED).map(tree.read), tree.client()];
    assert.equal(patchWorkspacePluginCommands(tree.root), 4);
    assert.deepEqual([...Object.keys(GENERATED).map(tree.read), tree.client()], once);
  } finally {
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('an app spec without workspace plugin commands is left alone', () => {
  const tree = generatedTree([]);
  try {
    assert.equal(patchWorkspacePluginCommands(tree.root), 0);
    assert.ok(!fs.existsSync(path.join(tree.dir, WORKSPACE_PLUGIN_HELPER_FILE)));
    assert.equal(tree.client(), GENERATED_CLIENT);
  } finally {
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('fails loudly when the generated retry policy no longer matches', () => {
  const tree = generatedTree();
  try {
    fs.writeFileSync(
      path.join(tree.root, 'internal/client/client.go'),
      GENERATED_CLIENT.replace('const maxRetries = 3', 'const maxRetries = 5')
    );
    assert.throws(
      () => patchWorkspacePluginCommands(tree.root),
      /Workspace plugin command contract changed: client retry policy/
    );
  } finally {
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('fails loudly when Printing Press output no longer matches', () => {
  const tree = generatedTree(['reset-workspace-plugin']);
  try {
    const file = path.join(tree.dir, 'promoted_reset-workspace-plugin.go');
    fs.writeFileSync(file, GENERATED['reset-workspace-plugin'].replace('var flagYes string', 'var flagYes bool'));
    assert.throws(
      () => patchWorkspacePluginCommands(tree.root),
      /Workspace plugin command contract changed: reset-workspace-plugin/
    );
  } finally {
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

const binary = process.env.REALTIMEX_WORKSPACE_PLUGIN_TEST_CLI;
test('compiled workspace plugin commands send the documented requests', { skip: !binary }, async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const url = new URL(req.url, 'http://fixture');
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: raw ? JSON.parse(raw) : null,
      token: req.headers.authorization,
    });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/explode')) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
      return;
    }
    if (url.pathname.endsWith('/flaky') && requests.filter((request) => request.path === url.pathname).length === 1) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
      return;
    }
    if (url.pathname.endsWith('/refused')) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'Plugin not found.', code: 'PLUGIN_NOT_FOUND' }));
      return;
    }
    res.end(JSON.stringify({ success: true, workspace: { id: 1, slug: 'scratch', name: 'Scratch' }, plugin: { id: 'plugin-a' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-plugin-cli-home-'));
  async function run(args) {
    const child = spawn(binary, [...args, '--json', '--no-cache'], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        REALTIMEX_BASE_URL: `http://127.0.0.1:${server.address().port}/cli`,
        REALTIMEX_TERMINAL_SESSION_TOKEN: 'fixture-session-token',
        REALTIMEX_PP_CLI_PLUGIN_UPDATE_CHECK: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (part) => output += part);
    child.stderr.on('data', (part) => output += part);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    return { code, output };
  }
  async function refused(args, message) {
    const before = requests.length;
    const result = await run(args);
    assert.notEqual(result.code, 0, `${args.join(' ')}\n${result.output}`);
    if (message) assert.match(result.output, message);
    assert.equal(requests.length, before, `${args.join(' ')} sent a request`);
  }
  const target = ['--workspace-slug', 'scratch'];
  try {
    const listed = await run(['list-workspace-plugins', ...target]);
    assert.equal(listed.code, 0, listed.output);
    assert.deepEqual(requests.at(-1), { method: 'GET', path: '/cli/list-workspace-plugins', query: { workspaceSlug: 'scratch' }, body: null, token: 'RealtimeX-Terminal fixture-session-token' });

    const got = await run(['get-workspace-plugin', 'Example Plugin', ...target]);
    assert.equal(got.code, 0, got.output);
    assert.equal(requests.at(-1).path, '/cli/get-workspace-plugin/Example%20Plugin');
    assert.deepEqual(requests.at(-1).query, { workspaceSlug: 'scratch' });

    const disabled = await run(['set-workspace-plugin', 'plugin-a', ...target, '--enabled', 'false']);
    assert.equal(disabled.code, 0, disabled.output);
    assert.deepEqual(requests.at(-1), { method: 'POST', path: '/cli/set-workspace-plugin/plugin-a', query: { workspaceSlug: 'scratch' }, body: { enabled: false }, token: 'RealtimeX-Terminal fixture-session-token' });
    await run(['set-workspace-plugin', 'plugin-a', ...target, '--enabled=true']);
    assert.deepEqual(requests.at(-1).body, { enabled: true });

    const configured = await run([
      'set-workspace-plugin', 'plugin-a', ...target,
      '--config', 'MODE=review', '--config', 'COUNT=0', '--config', 'FLAG=false',
      '--config', 'TAGS=["a","b"]', '--config', 'QUOTED="5"', '--config', 'EMPTY=',
      '--config', 'URL=https://example.com/?a=b', '--config', 'SPACED=two words',
    ]);
    assert.equal(configured.code, 0, configured.output);
    assert.deepEqual(requests.at(-1).body, {
      config: { MODE: 'review', COUNT: 0, FLAG: false, TAGS: ['a', 'b'], QUOTED: '5', EMPTY: '', URL: 'https://example.com/?a=b', SPACED: 'two words' },
    });

    const fromJson = await run(['set-workspace-plugin', 'plugin-a', ...target, '--enabled', 'true', '--config-json', '{"VIP_SENDERS":["boss@example.com"],"AGE":30}']);
    assert.equal(fromJson.code, 0, fromJson.output);
    assert.deepEqual(requests.at(-1).body, { enabled: true, config: { VIP_SENDERS: ['boss@example.com'], AGE: 30 } });

    await refused(['set-workspace-plugin', 'plugin-a', '--enabled', 'false'], /workspace-slug/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target], /provide --enabled/);
    // A bare --enabled takes the next argument as its value or has none.
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--enabled'], /needs an argument|true or false/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--enabled', 'yes'], /true or false/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--enabled', 'False'], /true or false/);
    await refused(['set-workspace-plugin', 'plugin-a', 'false', ...target, '--enabled', 'true'], /one plugin/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config', 'MODE'], /KEY=VALUE/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config', '=x'], /KEY=VALUE/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config', 'MODE=a', '--config', 'MODE=b'], /more than once/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config-json', '["MODE"]'], /JSON object/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config-json', 'null'], /JSON object/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config-json', '{"MODE":'], /JSON object/);
    await refused(['set-workspace-plugin', 'plugin-a', ...target, '--config', 'MODE=a', '--config-json', '{}'], /not both/);
    await refused(['list-workspace-plugins', 'extra', ...target], /no arguments/);

    // Reset sends nothing without its own --yes; --agent sets only the root
    // prompt-skipping flag and does not confirm it.
    await refused(['reset-workspace-plugin', 'plugin-a', ...target], /--yes/);
    await refused(['reset-workspace-plugin', 'plugin-a', ...target, '--agent'], /--yes/);
    await refused(['reset-workspace-plugin', 'plugin-a', ...target, '--yes=false'], /--yes/);
    await refused(['reset-workspace-plugin', 'plugin-a', ...target, '--yes', 'true'], /one plugin/);
    const reset = await run(['reset-workspace-plugin', 'plugin-a', ...target, '--yes']);
    assert.equal(reset.code, 0, reset.output);
    assert.deepEqual(requests.at(-1), { method: 'DELETE', path: '/cli/reset-workspace-plugin/plugin-a', query: { workspaceSlug: 'scratch', yes: 'true' }, body: null, token: 'RealtimeX-Terminal fixture-session-token' });

    // A set or reset is sent exactly once, even on a 5xx: its outcome is read
    // back, not replayed. Reads keep the generated retry.
    for (const [command, extra] of [['set-workspace-plugin', ['--enabled', 'false']], ['reset-workspace-plugin', ['--yes']]]) {
      const before = requests.length;
      const exploded = await run([command, 'explode', ...target, ...extra]);
      assert.notEqual(exploded.code, 0, exploded.output);
      assert.equal(requests.length - before, 1, `${command} was replayed`);
      assert.doesNotMatch(exploded.output, /retrying/);
    }
    // Every read reaches the server: a repeated get is not answered from the
    // response cache, so a refused set or a Settings change reads back.
    const readsBefore = requests.length;
    for (let i = 0; i < 2; i += 1) {
      const fresh = await run(['get-workspace-plugin', 'plugin-a', ...target]);
      assert.equal(fresh.code, 0, fresh.output);
    }
    assert.equal(requests.length - readsBefore, 2);
    await refused(['list-workspace-plugins', ...target, '--data-source', 'local'], /live/);

    const flakyBefore = requests.length;
    const flaky = await run(['get-workspace-plugin', 'flaky', ...target]);
    assert.equal(flaky.code, 0, flaky.output);
    assert.equal(requests.length - flakyBefore, 2);

    const failed = await run(['get-workspace-plugin', 'refused', ...target]);
    assert.notEqual(failed.code, 0);
    assert.match(failed.output, /PLUGIN_NOT_FOUND|Plugin not found/);

    const help = await run(['set-workspace-plugin', '--help']);
    assert.match(help.output, /--config stringArray/);
    assert.match(help.output, /--config-json string/);
    assert.match(help.output, /--enabled string/);
    assert.match((await run(['reset-workspace-plugin', '--help'])).output, /--agent does not confirm it/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
