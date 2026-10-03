import { isMatching } from 'ts-pattern';
import type { Connect, Plugin } from 'vite';

export const isClientDisconnect = (error: unknown, aborted: boolean) =>
  aborted && isMatching({ code: 'ECONNRESET', message: 'aborted' }, error);

export function clientDisconnectPlugin(): Plugin {
  return {
    name: 'start-ui:client-disconnect',
    apply: 'serve',
    configureServer(server) {
      // Install after Nitro's request middleware. Node emits this error when
      // a browser closes an in-flight request; broadcasting a Vite overlay
      // would incorrectly interrupt every other connected local browser.
      return () => {
        const handleError: Connect.ErrorHandleFunction = (
          error,
          request,
          _response,
          next
        ) => {
          if (isClientDisconnect(error, request.aborted)) return;
          next(error);
        };
        server.middlewares.use(handleError);
      };
    },
  };
}
