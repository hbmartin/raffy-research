import { isMatching } from 'ts-pattern';
import type { Connect, Plugin } from 'vite';

export const isClientDisconnect = (error: unknown, aborted: boolean) =>
  aborted && isMatching({ code: 'ECONNRESET', message: 'aborted' }, error);

export function clientDisconnectPlugin(): Plugin {
  return {
    name: 'start-ui:client-disconnect',
    apply: 'serve',
    configureServer(server) {
      const prematurelyClosed = new WeakSet<object>();
      server.middlewares.use((_request, response, next) => {
        response.once('close', () => {
          if (!response.writableFinished) prematurelyClosed.add(response);
        });
        next();
      });
      // Install after Nitro's request middleware. Node emits this error when
      // a browser closes an in-flight request; broadcasting a Vite overlay
      // would incorrectly interrupt every other connected local browser.
      return () => {
        const handleError: Connect.ErrorHandleFunction = (
          error,
          _request,
          response,
          next
        ) => {
          if (
            isClientDisconnect(
              error,
              prematurelyClosed.has(response) && !response.writableFinished
            )
          )
            return;
          next(error);
        };
        server.middlewares.use(handleError);
      };
    },
  };
}
