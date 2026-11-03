export async function listenOnAvailablePort(server, startPort, maxAttempts = 20) {
  let currentPort = startPort;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('error', onError);
          reject(error);
        };

        server.once('error', onError);
        server.listen(currentPort, '127.0.0.1', () => {
          server.off('error', onError);
          resolve();
        });
      });

      return currentPort;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        throw error;
      }

      currentPort += 1;
    }
  }

  throw new Error(`Unable to find an available port starting from ${startPort}`);
}
