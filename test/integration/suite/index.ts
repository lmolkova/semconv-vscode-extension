import * as path from 'path';
import Mocha from 'mocha';
import fg from 'fast-glob';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20000 });
  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    fg('**/*.test.js', { cwd: testsRoot, absolute: true })
      .then((files) => {
        files.forEach((f) => mocha.addFile(f));
        try {
          mocha.run((failures) => {
            if (failures > 0) reject(new Error(`${failures} tests failed.`));
            else resolve();
          });
        } catch (err) {
          reject(err);
        }
      })
      .catch(reject);
  });
}
