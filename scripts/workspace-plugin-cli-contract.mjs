import fs from 'node:fs';
import path from 'node:path';

// Printing Press renders set-workspace-plugin's config as one JSON string and
// its enabled field as a bare boolean, so `--enabled false` would turn the
// plugin on and leave "false" as a stray argument. It renders reset's yes as
// an ordinary value, and the root --yes that --agent sets would not guard it.
// These commands instead take repeated --config KEY=VALUE or one
// --config-json object, an explicit --enabled true|false, and a reset that
// sends nothing without its own --yes (rtgit #2535).

const MARKER = '// realtimex-sdk workspace plugin command contract';

export const WORKSPACE_PLUGIN_HELPER_FILE = 'workspace_plugin_contract.go';

const HELPER_SOURCE = `// Added by realtimex-sdk scripts/workspace-plugin-cli-contract.mjs (rtgit #2535).

package cli

import (
	"encoding/json"
	"fmt"
	"strings"
)

// workspacePluginConfigBody builds set-workspace-plugin's config object from
// repeated --config KEY=VALUE flags or from one --config-json object.
func workspacePluginConfigBody(pairs []string, rawJSON string, pairsSet bool, jsonSet bool) (map[string]any, error) {
	if pairsSet && jsonSet {
		return nil, fmt.Errorf("choose --config or --config-json, not both")
	}
	if jsonSet {
		var config map[string]any
		if !json.Valid([]byte(rawJSON)) || workspacePluginDecodeJSON(rawJSON, &config) != nil || config == nil {
			return nil, fmt.Errorf("--config-json must be a JSON object")
		}
		return config, nil
	}
	if !pairsSet {
		return nil, nil
	}
	config := map[string]any{}
	for _, pair := range pairs {
		key, value, found := strings.Cut(pair, "=")
		if !found || strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("--config takes KEY=VALUE")
		}
		if _, duplicate := config[key]; duplicate {
			return nil, fmt.Errorf("--config sets %q more than once", key)
		}
		config[key] = workspacePluginConfigValue(value)
	}
	return config, nil
}

// A VALUE that is one valid JSON value is sent as JSON (5, true, ["a"], "5");
// anything else, including an empty VALUE, is sent as text.
func workspacePluginConfigValue(value string) any {
	var parsed any
	if json.Valid([]byte(value)) && workspacePluginDecodeJSON(value, &parsed) == nil {
		return parsed
	}
	return value
}

func workspacePluginDecodeJSON(raw string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	return decoder.Decode(target)
}

// workspacePluginEnabledBody accepts only an explicit true or false, and
// reports nil when --enabled was not given so the selection is kept.
func workspacePluginEnabledBody(value string, set bool) (*bool, error) {
	if !set {
		return nil, nil
	}
	switch value {
	case "true":
		enabled := true
		return &enabled, nil
	case "false":
		enabled := false
		return &enabled, nil
	}
	return nil, fmt.Errorf("--enabled takes true or false")
}
`;

function argumentGuard(command, maxArgs) {
  const message =
    maxArgs === 0
      ? `${command} takes no arguments`
      : `${command} takes one plugin id or name`;
  return `${MARKER}
			if len(args) > ${maxArgs} {
				return usageErr(fmt.Errorf("${message}"))
			}
`;
}

const COMMANDS = {
  'list-workspace-plugins': (edit) => {
    edit('c, err := flags.newClient()', `${argumentGuard('list-workspace-plugins', 0)}			c, err := flags.newClient()`);
  },
  'get-workspace-plugin': (edit) => {
    edit('c, err := flags.newClient()', `${argumentGuard('get-workspace-plugin', 1)}			c, err := flags.newClient()`);
  },
  'set-workspace-plugin': (edit) => {
    edit(/var bodyConfig string\s+var bodyEnabled bool/, 'var bodyConfig []string\n\tvar bodyConfigJSON string\n\tvar bodyEnabled string');
    edit(/Example:\s+"[^"\n]*",/, 'Example:     "  realtimex-pp-cli set-workspace-plugin <plugin> --workspace-slug <slug> --enabled false\\n  realtimex-pp-cli set-workspace-plugin <plugin> --workspace-slug <slug> --config MODE=review --config CADENCE=1d\\n  realtimex-pp-cli set-workspace-plugin <plugin> --workspace-slug <slug> --config-json \'{\\"VIP_SENDERS\\":[\\"boss@example.com\\"]}\'",');
    edit('c, err := flags.newClient()', `${argumentGuard('set-workspace-plugin', 1)}			workspacePluginConfig, configErr := workspacePluginConfigBody(bodyConfig, bodyConfigJSON, cmd.Flags().Changed("config"), cmd.Flags().Changed("config-json"))
			if configErr != nil {
				return usageErr(configErr)
			}
			workspacePluginEnabled, enabledErr := workspacePluginEnabledBody(bodyEnabled, cmd.Flags().Changed("enabled"))
			if enabledErr != nil {
				return usageErr(enabledErr)
			}
			if workspacePluginConfig == nil && workspacePluginEnabled == nil {
				return usageErr(fmt.Errorf("provide --enabled true|false, --config KEY=VALUE or --config-json"))
			}
			c, err := flags.newClient()`);
    edit(
      /if bodyConfig != "" \{[\s\S]*?body\["config"\] = parsedConfig\s*\}\s*if cmd\.Flags\(\)\.Changed\("enabled"\) \{\s*body\["enabled"\] = bodyEnabled\s*\}/,
      `if workspacePluginConfig != nil {
				body["config"] = workspacePluginConfig
			}
			if workspacePluginEnabled != nil {
				body["enabled"] = *workspacePluginEnabled
			}`
    );
    edit(
      /cmd\.Flags\(\)\.StringVar\(&bodyConfig, "config", "", "[^"\n]*"\)/,
      'cmd.Flags().StringArrayVar(&bodyConfig, "config", nil, "Set one non-secret workspace setting as KEY=VALUE; repeat for more. VALUE is sent as JSON when it is valid JSON (5, true, [\\"a\\"], \\"5\\"), otherwise as text. Settings you leave out keep their current workspace values.")\n\tcmd.Flags().StringVar(&bodyConfigJSON, "config-json", "", "Non-secret workspace settings as one JSON object; cannot be combined with --config.")'
    );
    edit(
      /cmd\.Flags\(\)\.BoolVar\(&bodyEnabled, "enabled", false, "[^"\n]*"\)/,
      'cmd.Flags().StringVar(&bodyEnabled, "enabled", "", "true turns the plugin on in this workspace, false turns it off. Omit it to keep the current selection.")'
    );
  },
  'reset-workspace-plugin': (edit) => {
    edit('var flagYes string', 'var flagYes bool');
    edit(/Example:\s+"[^"\n]*",/, 'Example:     "  realtimex-pp-cli reset-workspace-plugin <plugin> --workspace-slug <slug> --yes",');
    edit(
      /if !cmd\.Flags\(\)\.Changed\("yes"\) && !flags\.dryRun \{\s*return fmt\.Errorf\("required flag \\"%s\\" not set", "yes"\)\s*\}/,
      `if !flagYes {
				return usageErr(fmt.Errorf("reset-workspace-plugin removes this workspace's selection and every workspace setting of the plugin; pass --yes to confirm (--agent does not)"))
			}`
    );
    edit('c, err := flags.newClient()', `${argumentGuard('reset-workspace-plugin', 1)}			c, err := flags.newClient()`);
    edit(/if flagYes != "" \{\s*params\["yes"\] = fmt\.Sprintf\("%v", flagYes\)\s*\}/, 'params["yes"] = "true"');
    edit(
      /cmd\.Flags\(\)\.StringVar\(&flagYes, "yes", "", "[^"\n]*"\)/,
      'cmd.Flags().BoolVar(&flagYes, "yes", false, "Confirm the reset. It removes this workspace\'s selection and every workspace setting of the plugin, including secrets set in Workspace Settings. --agent does not confirm it.")'
    );
  },
};

export function patchWorkspacePluginCommands(sourceDir) {
  const dir = path.join(sourceDir, 'internal/cli');
  let patched = 0;
  for (const [command, patch] of Object.entries(COMMANDS)) {
    const file = path.join(dir, `promoted_${command}.go`);
    if (!fs.existsSync(file)) continue; // Older app specs have no workspace plugin API.
    let source = fs.readFileSync(file, 'utf8');
    if (!source.includes(MARKER)) {
      patch((pattern, value) => {
        const next = source.replace(pattern, value);
        if (next === source) {
          throw new Error(`Workspace plugin command contract changed: ${command}`);
        }
        source = next;
      });
      fs.writeFileSync(file, source);
    }
    patched += 1;
  }
  if (patched > 0) {
    fs.writeFileSync(path.join(dir, WORKSPACE_PLUGIN_HELPER_FILE), HELPER_SOURCE);
  }
  return patched;
}
