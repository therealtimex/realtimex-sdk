# Credentials Reference

Credentials are managed by the user in **Settings > Credentials**. Agents have read-only access via `sdk.credentials`.

## Security Rules

1. **Never** print credential values to stdout (they become tool results in chat history)
2. **Never** include credential values in your response text
3. **Never** write credential values to files or logs
4. **Never** pass credential values as CLI arguments (visible in process list)
5. **Always** consume credentials inside scripts — fetch, use, discard
6. **Never** write helper scripts into the SKILL directory — use the working directory or system temp

## Credential Types

| Type | Payload | How to Apply |
|------|---------|-------------|
| `http_header` | `{ name, value }` | Set as HTTP header: `headers[payload.name] = payload.value` |
| `query_auth` | `{ name, value }` | Append to URL: `?${payload.name}=${payload.value}` |
| `basic_auth` | `{ username, password }` | Encode: `Authorization: Basic ${btoa(username + ":" + password)}` |
| `env_var` | `{ name, value }` | Set in subprocess: `env[payload.name] = payload.value` |

## Usage Patterns

### List available credentials

```bash
node "$SKILL" credentials
```

Output: table of names and types (no values).

### Use an http_header credential in a script

```javascript
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
(async () => {
  const { sdk } = await initSDK();
  const cred = await sdk.credentials.get('github-token');
  // cred.type === "http_header"
  // cred.payload === { name: "Authorization", value: "Bearer ghp_xxx" }
  const res = await fetch('https://api.github.com/user', {
    headers: { [cred.payload.name]: cred.payload.value }
  });
  console.log('Status:', res.status); // Only non-sensitive output
})();
```

### Use a basic_auth credential

```javascript
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
(async () => {
  const { sdk } = await initSDK();
  const cred = await sdk.credentials.get('registry-login');
  const auth = Buffer.from(cred.payload.username + ':' + cred.payload.password).toString('base64');
  const res = await fetch('https://registry.example.com/v2/_catalog', {
    headers: { 'Authorization': 'Basic ' + auth }
  });
  console.log('Status:', res.status);
})();
```

### Use an env_var credential with a subprocess

```javascript
const { initSDK } = require('<SKILL_DIR>/scripts/lib/sdk-init');
const { execSync } = require('child_process');
(async () => {
  const { sdk } = await initSDK();
  const cred = await sdk.credentials.get('aws-key');
  // cred.type === "env_var"
  // cred.payload === { name: "AWS_ACCESS_KEY_ID", value: "AKIA..." }
  execSync('aws s3 ls', {
    env: { ...process.env, [cred.payload.name]: cred.payload.value },
    stdio: 'inherit'
  });
})();
```

### Error handling

```javascript
try {
  const cred = await sdk.credentials.get('my-key');
  // use cred...
} catch (err) {
  if (err.message.includes('not found')) {
    console.log('Credential not found. Ask the user to add it in Settings > Credentials.');
  } else {
    console.log('Error:', err.message);
  }
}
```
