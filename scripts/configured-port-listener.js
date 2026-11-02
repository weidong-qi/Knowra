export async function listenOnConfiguredPort(server, configuredPort, options = {}) {
  const { allowPortFallback = true, host = '127.0.0.1', maxAttempts = 20 } = options;
  const attempts = allowPortFallback ? maxAttempts : 1;

  for (let offset = 0; offset < attempts; offset += 1) {
    const port = configuredPort + offset;
    try {
      await listen(server, port, host);
      return port;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
      if (!allowPortFallback) {
        /** @type {Error & Partial<Pick<import('../apps/api/src/errors/app-error.ts').AppError, 'code'>>} */
        const configuredPortError = new Error(
          `Configured production port ${configuredPort} is already in use; refusing to select another port.`
        );
        configuredPortError.code = 'EADDRINUSE';
        configuredPortError.cause = error;
        throw configuredPortError;
      }
    }
  }

  throw new Error(`Unable to find an available port starting from ${configuredPort}`);
}

function listen(server, port, host) {
  return new Promise(
    /** @param {(value?: void) => void} resolve */ (resolve, reject) => {
      const onError = error => {
        server.off('error', onError);
        reject(error);
      };

      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        resolve();
      });
    }
  );
}
