'use strict';
/**
 * acp-session-chat.js
 * Create (or reuse) an ACP session and stream a chat message,
 * auto-resolving any permission requests via resolvePermission().
 *
 * Usage:
 *   node acp-session-chat.js <agent-id> <message> [--cwd=<path>] [--session=<key>] [--env-dir=<path>]
 */

const { initSDK } = require('./lib/sdk-init');

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [k, ...v] = arg.slice(2).split('=');
      flags[k] = v.join('=') || true;
    } else {
      positional.push(arg);
    }
  }

  const agentId  = positional[0];
  const message  = positional[1];
  const cwd      = flags['cwd']     || process.cwd();
  const envDir   = flags['env-dir'] || process.cwd();
  let sessionKey = flags['session'] || null;

  if (!agentId || !message) {
    console.error('Usage: node acp-session-chat.js <agent-id> <message> [--cwd=<path>] [--session=<key>] [--env-dir=<path>]');
    process.exit(1);
  }

  const { sdk } = await initSDK({ envDir });

  // Create a new session if none provided
  if (!sessionKey) {
    process.stderr.write(`Creating ACP session for "${agentId}" with cwd=${cwd}...\n`);
    const session = await sdk.acpAgent.createSession({
      agent_id: agentId,
      cwd,
      approvalPolicy: 'approve-all',
    });
    sessionKey = session.session_key;
    process.stderr.write(`Session created: ${sessionKey}\n`);
  } else {
    process.stderr.write(`Reusing session: ${sessionKey}\n`);
  }

  process.stderr.write(`\n--- Sending message ---\n${message}\n-----------------------\n\n`);

  // Stream the chat, resolving permissions as they arrive
  const stream = sdk.acpAgent.streamChat(sessionKey, message);

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta': {
        // Skip internal reasoning/thinking
        if (event.data && event.data.type === 'thinking') break;
        const text = event.data?.text ?? event.data ?? '';
        if (text) process.stdout.write(String(text));
        break;
      }

      case 'permission_request': {
        const req = event.data;
        process.stderr.write(`\n[Permission Request] ${JSON.stringify(req)}\n`);

        // Auto-approve: pick the first option that looks like "approve" or just the first option
        const options = req.options || [];
        const approveOpt = options.find(o =>
          /approve|allow|yes|confirm/i.test(o.label || o.id || o.optionId || '')
        ) || options[0];

        if (approveOpt) {
          const optionId = approveOpt.id || approveOpt.optionId || approveOpt;
          process.stderr.write(`[Permission] Auto-approving option: ${optionId}\n`);
          await sdk.acpAgent.resolvePermission(sessionKey, {
            requestId: req.requestId || req.id,
            optionId,
            outcome: 'approved',
          });
        } else {
          process.stderr.write(`[Permission] No options found, skipping resolve.\n`);
        }
        break;
      }

      case 'error': {
        process.stderr.write(`\n[Error] ${JSON.stringify(event.data)}\n`);
        break;
      }

      case 'done':
      case 'end':
        break;

      default:
        // Uncomment for debugging:
        // process.stderr.write(`[event:${event.type}] ${JSON.stringify(event.data)}\n`);
        break;
    }
  }

  process.stdout.write('\n');
  process.stderr.write(`\nSession key (reuse with --session=${sessionKey}): ${sessionKey}\n`);
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
