/**
 * Port utilities for Local Apps
 * Helps find available ports to avoid conflicts when multiple apps run simultaneously
 */

import * as net from 'net';

export class PortModule {
    private defaultPort: number;

    constructor(defaultPort: number = 8080) {
        this.defaultPort = defaultPort;
    }

    /**
     * Get suggested port from environment (RTX_PORT) or default
     */
    getSuggestedPort(): number {
        const envPort = process.env.RTX_PORT;
        return envPort ? parseInt(envPort, 10) : this.defaultPort;
    }

    /**
     * Check if a port is available
     * @param port - Port number to check
     * @returns Promise resolving to true if port is available
     */
    async isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close();
                resolve(true);
            });
            server.listen(port, '127.0.0.1');
        });
    }

    /**
     * Find an available port starting from the suggested port
     * @param startPort - Starting port number (default: RTX_PORT or defaultPort)
     * @param maxAttempts - Maximum ports to try (default: 100)
     * @returns Promise resolving to an available port number
     * @throws Error if no available port found in range
     */
    async findAvailablePort(startPort?: number, maxAttempts: number = 100): Promise<number> {
        const port = startPort ?? this.getSuggestedPort();

        for (let i = 0; i < maxAttempts; i++) {
            const currentPort = port + i;
            if (await this.isPortAvailable(currentPort)) {
                return currentPort;
            }
        }

        throw new Error(`No available port found in range ${port}-${port + maxAttempts - 1}`);
    }

    /**
     * Get a ready-to-use port
     * Returns the suggested port if available, otherwise finds the next available port
     * 
     * @example
     * ```typescript
     * const sdk = new RealtimeXSDK();
     * const port = await sdk.port.getPort();
     * app.listen(port);
     * ```
     */
    async getPort(): Promise<number> {
        const suggested = this.getSuggestedPort();
        if (await this.isPortAvailable(suggested)) {
            return suggested;
        }
        return this.findAvailablePort(suggested + 1);
    }
}
