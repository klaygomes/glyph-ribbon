import { Stage, type StageEvent, type StageMessage } from './stage.js';

const scope = self as unknown as {
  postMessage(message: StageEvent): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<StageMessage>) => void): void;
};

const stage = new Stage((event) => scope.postMessage(event));

scope.addEventListener('message', (event) => {
  try {
    stage.handleMessage(event.data);
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});

scope.postMessage({ type: 'hello' });
