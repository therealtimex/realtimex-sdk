const { RealtimeXSDK } = require('./typescript/dist/index.js');
async function verifySTT() {
    console.log('Verifying STT Module...');
    
    // Initialize SDK (pointing to local backend)
    const sdk = new RealtimeXSDK({
        realtimex: {
            apiKey: 'YK5SNGQ-67EM25S-JFKFJCT-HR43YCT', // Dummy key for dev mode
            url: 'http://localhost:3001'
        }
    });
    try {
        console.log('Testing stt.listen()...');
        console.log('Please speak into your microphone...');
        
        // Timeout 10s for test
        const result = await sdk.stt.listen({
            provider: 'native', // or 'whisper' / 'groq'
            timeout: 10000 
        });
        console.log('STT Result:', result);
        
        if (result.success && result.text) {
            console.log('SUCCESS: Transcribed text:', result.text);
        } else {
            console.error('FAILED: No text returned', result);
        }
    } catch (error) {
        console.error('Verification failed:', error);
    }
}
verifySTT();
