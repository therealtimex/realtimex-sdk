const { RealtimeXSDK } = require('./typescript/dist/index.js');
const fs = require('fs');
const path = require('path');

async function verifyTTS() {
    console.log('Verifying TTS Module...');

    // Initialize SDK (assuming dev mode with API key or just connecting to local backend)
    // For this test, we assume the backend is running on localhost:3001
    // We use a dummy API key to trigger dev mode logic in SDK, 
    // but the backend might need a real key if it checks it. 
    // However, for local dev, usually any key works or we can use the app_id flow if we had one.
    // Let's try with a dummy key.
    const sdk = new RealtimeXSDK({
        realtimex: {
            apiKey: 'YK5SNGQ-67EM25S-JFKFJCT-HR43YCT',
            url: 'http://localhost:3001'
        }
    });

    try {
        // 1. Test speak (buffer)
        console.log('Testing speak (buffer)...');
        const buffer = await sdk.tts.speak('Hello from RealtimeX SDK verification script.');
        if (buffer && buffer.byteLength > 0) {
            console.log(`Success! Received buffer of size: ${buffer.byteLength}`);
            fs.writeFileSync(path.join(__dirname, 'test_output.mp3'), Buffer.from(buffer));
            console.log('Saved to test_output.mp3');
        } else {
            console.error('Failed: Received empty buffer');
        }

        // 2. Test speakStream (stream)
        console.log('Testing speakStream (stream)...');
        const stream = await sdk.tts.speakStream('This is a streaming test from RealtimeX SDK.');
        const writeStream = fs.createWriteStream(path.join(__dirname, 'test_output_stream.mp3'));
        
        let totalBytes = 0;
        for await (const chunk of stream) {
            totalBytes += chunk.length;
            writeStream.write(chunk);
        }
        writeStream.end();
        console.log(`Success! Streamed total bytes: ${totalBytes}`);
        console.log('Saved to test_output_stream.mp3');

        // 3. Test listProviders
        console.log('Testing listProviders...');
        const providers = await sdk.tts.listProviders();
        console.log('Providers:', JSON.stringify(providers, null, 2));

    } catch (error) {
        console.error('Verification failed:', error);
    }
}

verifyTTS();
