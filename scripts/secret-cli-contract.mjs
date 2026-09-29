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
    if (command === 'create-secret' && source.includes('!cmd.Flags().Changed("value")')) {
      replace('!cmd.Flags().Changed("value")', source.includes('var bodyUsername string') ? '!valueStdin && !loginStdin' : '!valueStdin');
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
    if (source.includes('var bodyUsername string')) {
      replace('var valueStdin bool', 'var valueStdin bool\n var loginStdin bool\n var loginFields map[string]string');
      replace(/cmd.Flags\(\).StringVar\(&bodyUsername, "username", "", "[^"]*"\)/,
        'cmd.Flags().BoolVar(&loginStdin, "login-stdin", false, "Read a JSON object containing username and/or password from stdin; never pass login values as arguments")');
      replace(/cmd.Flags\(\).StringVar\(&bodyPassword, "password", "", "[^"]*"\)/, '// Password is accepted only through login-stdin.');
      replace('if valueStdin {', `if loginStdin && valueStdin { return fmt.Errorf("choose --login-stdin or --value-stdin") }
        if loginStdin {
          if flags.dryRun { return fmt.Errorf("login stdin cannot be used with --dry-run") }
          raw, readErr := io.ReadAll(io.LimitReader(cmd.InOrStdin(), 262145))
          if readErr != nil || len(raw) == 0 || len(raw) > 262144 { return fmt.Errorf("login stdin must contain a JSON object of at most 256 KiB") }
          if json.Unmarshal(raw, &loginFields) != nil || len(loginFields) == 0 { return fmt.Errorf("login stdin must contain username and/or password strings") }
          for key, value := range loginFields {
            if key != "username" && key != "password" { return fmt.Errorf("login stdin accepts only username and password") }
            if len(value) == 0 || len(value) > 65536 { return fmt.Errorf("login fields must contain 1 to 65536 bytes") }
          }
        }
        if valueStdin {`);
      replace('if allWorkspaces { body["workspaceSlugs"] = nil }', `for key, value := range loginFields { body[key] = value }
        if allWorkspaces { body["workspaceSlugs"] = nil }`);
    }
    if (source.includes('var bodyFields string')) {
      replace('var valueStdin bool', 'var valueStdin bool\n var itemStdin bool\n var itemFields map[string]json.RawMessage');
      replace(/cmd.Flags\(\).StringVar\(&bodyFields, "fields", "", "[^\"]*"\)/,
        'cmd.Flags().BoolVar(&itemStdin, "item-stdin", false, "Read JSON containing fields and/or notes from trusted stdin (max 1 MiB); never pass values as arguments")');
      replace(/cmd.Flags\(\).StringVar\(&bodyNotes, "notes", "", "[^\"]*"\)/, '// Notes are accepted only through item-stdin.');
      replace('if loginStdin && valueStdin {', `if itemStdin && (loginStdin || valueStdin) { return fmt.Errorf("choose only one stdin mode") }
        if itemStdin {
          if flags.dryRun { return fmt.Errorf("item stdin cannot be used with --dry-run") }
          raw, readErr := io.ReadAll(io.LimitReader(cmd.InOrStdin(), 1048577))
          if readErr != nil || len(raw) == 0 || len(raw) > 1048576 { return fmt.Errorf("item stdin must contain a JSON object of at most 1 MiB") }
          if json.Unmarshal(raw, &itemFields) != nil || len(itemFields) == 0 { return fmt.Errorf("item stdin must contain fields and/or notes") }
          for key, value := range itemFields {
            if key == "fields" {
              var fields map[string]*string
              if json.Unmarshal(value, &fields) != nil || fields == nil { return fmt.Errorf("fields must be an object of strings or nulls") }
              for _, field := range fields { if field != nil && len(*field) > 65536 { return fmt.Errorf("field values must not exceed 64 KiB") } }
            } else if key == "notes" {
              var notes string
              if string(value) == "null" || json.Unmarshal(value, &notes) != nil || len(notes) > 65536 { return fmt.Errorf("notes must be a string of at most 64 KiB") }
            } else { return fmt.Errorf("item stdin accepts only fields and notes; use metadata flags for item settings") }
          }
        }
        if loginStdin && valueStdin {`);
      replace('for key, value := range loginFields { body[key] = value }', 'for key, value := range loginFields { body[key] = value }\n for key, value := range itemFields { body[key] = value }');
      for (const field of ['Tags', 'Websites', 'AllowedOrigins', 'CustomFields']) {
        const flag = field.replace(/[A-Z]/g, (letter, i) => (i ? '-' : '') + letter.toLowerCase());
        replace(`if body${field} != "" {`, `if cmd.Flags().Changed("${flag}") {`);
      }
    }
    fs.writeFileSync(file, source);
  }
}
