#!/usr/bin/env node

const path = require('path');

const sdkEntry = path.resolve(__dirname, '../dist/index.js');

let RealtimeXSDK;
try {
    ({ RealtimeXSDK } = require(sdkEntry));
} catch (error) {
    console.error(`Unable to load built SDK from ${sdkEntry}`);
    console.error('Run `npm run build` in the typescript package first.');
    process.exit(1);
}

function normalizeBaseUrl(value) {
    const baseUrl = value || 'http://localhost:3001';
    return baseUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
}

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing required env: ${name}`);
        process.exit(1);
    }
    return value;
}

async function main() {
    const workspaceSlug = getRequiredEnv('WORKSPACE_SLUG');
    const realtimexUrl = normalizeBaseUrl(process.env.BASE_URL || process.env.REALTIME_X_URL);
    const appId = process.env.X_APP_ID || process.env.RTX_APP_ID;
    const apiKey = process.env.RTX_API_KEY || process.env.API_KEY || process.env.ACCESS_TOKEN;

    if (!appId && !apiKey) {
        console.error('Missing auth env: set X_APP_ID or RTX_API_KEY/API_KEY/ACCESS_TOKEN');
        process.exit(1);
    }

    const sdk = new RealtimeXSDK({
        realtimex: {
            url: realtimexUrl,
            appId,
            apiKey,
        },
    });

    console.log(`POST ${realtimexUrl}/api/v1/workspace/${workspaceSlug}/thread/new`);

    const result = await sdk.v1.thread.createThread(workspaceSlug);
    const thread = result && typeof result === 'object' ? result.thread : undefined;

    console.log('status=ok');
    console.log(JSON.stringify(result, null, 2));

    if (!thread?.user_id) {
        console.warn(
            'warning=thread was created without a user owner; in multi-user mode it may not appear in the UI.'
        );
    }
}

main().catch((error) => {
    console.error(`status=error`);
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
