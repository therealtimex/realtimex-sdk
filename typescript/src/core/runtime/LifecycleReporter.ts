import type { RuntimeExecutionEvent } from '../types/runtime';

type ExecutionHandler = (event: RuntimeExecutionEvent) => void;

export class LifecycleReporter {
    private readonly handlers = new Set<ExecutionHandler>();

    onEvent(handler: ExecutionHandler): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    emit(event: RuntimeExecutionEvent): void {
        for (const handler of this.handlers) {
            try {
                handler(event);
            } catch {
                // Prevent listener failures from breaking runtime execution.
            }
        }
    }
}
