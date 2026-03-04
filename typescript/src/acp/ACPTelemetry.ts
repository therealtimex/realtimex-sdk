import type { ACPAdapterTelemetryEvent, ACPAdapterTelemetrySink } from './types';

export class ACPTelemetry {
    private readonly sink?: ACPAdapterTelemetrySink;

    constructor(sink?: ACPAdapterTelemetrySink) {
        this.sink = sink;
    }

    emit(event: ACPAdapterTelemetryEvent): void {
        if (!this.sink) return;

        try {
            const output = this.sink.emit(event);
            if (output && typeof (output as Promise<void>).then === 'function') {
                void (output as Promise<void>).catch(() => {});
            }
        } catch {
            // Telemetry errors should not affect runtime behavior.
        }
    }
}
