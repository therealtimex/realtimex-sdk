
import { ApiModule } from './api';
import { STTListenOptions, STTResponse } from '../types';

export class STTModule extends ApiModule {
    /**
     * Listen to microphone and transcribe speech to text.
     * Performed on the client device (Electron) via the RealtimeX Hub.
     * 
     * @param options Configuration options for listening
     * @returns Promise resolving to the transcribed text
     */
    public async listen(options: STTListenOptions = {}): Promise<STTResponse> {
        try {
            return await this.apiCall<STTResponse>('POST', '/sdk/stt/listen', {
                body: JSON.stringify(options),
            });
        } catch (error: any) {
            throw new Error(`STT listen failed: ${error.message}`);
        }
    }
}
