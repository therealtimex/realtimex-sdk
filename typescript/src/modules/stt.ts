
import { ApiModule } from './api';
import { STTListenOptions, STTResponse, STTModelsResponse, STTModel } from '../types';

export class STTModule extends ApiModule {
    /**
     * Get available STT models.
     * @returns Promise resolving to list of models
     */
    public async models(): Promise<STTModel[]> {
        try {
            const response = await this.apiCall<STTModelsResponse>('GET', '/sdk/stt/models');
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch models');
            }
            return response.models;
        } catch (error: any) {
            throw new Error(`STT models fetch failed: ${error.message}`);
        }
    }

    /**
     * Listen to microphone and transcribe speech to text.
     * Performed on the client device (Electron) via the RealtimeX Hub.
     * 
     * @param options Configuration options for listening
     * @returns Promise resolving to the transcribed text
     */
    public async listen(options: STTListenOptions): Promise<STTResponse> {
        try {
            return await this.apiCall<STTResponse>('POST', '/sdk/stt/listen', {
                body: JSON.stringify(options),
            });
        } catch (error: any) {
            throw new Error(`STT listen failed: ${error.message}`);
        }
    }
}
