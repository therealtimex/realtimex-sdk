
import { ApiModule } from './api';
import { STTListenOptions, STTResponse, STTProvidersResponse, STTProvider } from '../types';

export class STTModule extends ApiModule {
    /**
     * Get available STT providers and their models.
     * @returns Promise resolving to list of providers
     */
    public async listProviders(): Promise<STTProvider[]> {
        try {
            const response = await this.apiCall<STTProvidersResponse>('GET', '/sdk/stt/providers');
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch providers');
            }
            return response.providers;
        } catch (error: any) {
            throw new Error(`STT providers fetch failed: ${error.message}`);
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
