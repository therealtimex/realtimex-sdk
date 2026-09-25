import fs from 'node:fs';
import path from 'node:path';

// Printing Press exposes write-only strings as argv flags. Secrets instead
// accept bounded raw stdin and never render a dry-run containing that value.
export function patchSecretCommands(sourceDir) {
  for (const command of ['create-secret', 'update-secret']) {
    const file = path.join(sourceDir, 'internal/cli', `promoted_${command}.go`);
    if (!fs.existsSync(file)) continue; // Older app specs have no Secrets API.
    let source = fs.readFileSync(file, 'utf8');
    if (source.includes('var valueStdin bool')) continue;
    const replace = (pattern, value) => {
      const next = source.replace(pattern, value);
      if (next === source) throw new Error(`Secret command contract changed: ${command}`);
      source = next;
    };
    replace('"encoding/json"', '"encoding/json"\n "io"');
    replace('var bodyValue string', 'var bodyValue string\n var valueStdin bool\n var allWorkspaces bool');
    replace(/cmd.Flags\(\).StringVar\(&bodyValue, "value", "", "[^"]*"\)/,
      'cmd.Flags().BoolVar(&valueStdin, "value-stdin", false, "Read the exact secret value from stdin (max 64 KiB); never pass a value as an argument")\n cmd.Flags().BoolVar(&allWorkspaces, "all-workspaces", false, "Allow all workspaces; mutually exclusive with --workspace-slugs")');
    if (command === 'create-secret') {
      replace('!cmd.Flags().Changed("value")', '!valueStdin');
      replace('not set", "value")', 'not set", "value-stdin")');
    }
    replace('c, err := flags.newClient()', `if valueStdin {
        if flags.dryRun { return fmt.Errorf("secret stdin cannot be used with --dry-run") }
        raw, readErr := io.ReadAll(io.LimitReader(cmd.InOrStdin(), 65537))
        if readErr != nil || len(raw) == 0 || len(raw) > 65536 { return fmt.Errorf("secret stdin must contain 1 to 65536 bytes") }
        bodyValue = string(raw)
      }
      if allWorkspaces && cmd.Flags().Changed("workspace-slugs") { return fmt.Errorf("choose --all-workspaces or --workspace-slugs") }
      c, err := flags.newClient()`);
    replace('if bodyDescription != "" {', 'if cmd.Flags().Changed("description") {');
    replace('if bodyWorkspaceSlugs != "" {', 'if cmd.Flags().Changed("workspace-slugs") {');
    replace('data, statusCode, err := c.PostWithParams',
      'if allWorkspaces { body["workspaceSlugs"] = nil }\n data, statusCode, err := c.PostWithParams');
    fs.writeFileSync(file, source);
  }
}
