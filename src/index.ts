import path from 'path';
import fs from 'fs/promises';
import JSON5 from 'json5';
import chokidar from 'chokidar';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { debounce } from 'throttle-debounce';

export const tscClean = async () => {
  const {
    watch,
    project,
    silent,
    verbose,
    debounce: debounceTime,
  } = await yargs(hideBin(process.argv))
    .option('help', { alias: 'h' })
    .option('project', {
      alias: 'p',
      type: 'string',
      description: 'Path to tsconfig.json',
      default: './tsconfig.json',
    })
    .option('watch', {
      alias: 'w',
      type: 'boolean',
      description: 'Watch files',
      default: false,
    })
    .option('debounce', {
      alias: 'd',
      type: 'number',
      description: 'Debounce time for watch changes (ms)',
      default: 500,
    })
    .option('verbose', {
      alias: 'V',
      type: 'boolean',
      description: 'Show more log messages',
      default: false,
    })
    .option('silent', {
      alias: 's',
      type: 'boolean',
      description: 'Hide output messages',
      default: false,
    })
    .strict()
    .parse();

  const verbosePrint = (msg: string) => {
    if(verbose) {
      console.info(msg);
    }
  };
  const readTsConfigFields = async () => {
    const pathToTsConfig = path.resolve(project);
    verbosePrint(`Reading "rootDir" and "outDir" from TS config in "${pathToTsConfig}".`);

    const tsConfig = await fs.readFile(pathToTsConfig, 'utf-8').catch(e => {
      if((e as any)?.code === 'ENOENT') {
        throw new Error(`Could not open "${pathToTsConfig}"`);
      }
      throw e;
    });

    const { rootDir, outDir } = (JSON5.parse(tsConfig) as any)?.compilerOptions ?? {};
    verbosePrint(JSON.stringify({ rootDir, outDir }, null, 2));

    if(typeof rootDir !== 'string' || typeof outDir !== 'string') {
      throw new Error(
        `Could not find "rootDir" or "outDir" fields of type string of "compilerOptions" in "${pathToTsConfig}"`,
      );
    }

    const projectFolder = path.parse(project).dir;
    return {
      src: path.join(projectFolder, rootDir),
      dist: path.join(projectFolder, outDir),
    };
  };

  const { src, dist } = await readTsConfigFields();

  const preprocessFolder = async (dir = '') => {
    verbosePrint(`${path.posix.join(dist, dir)}:`);
    const files = await fs.readdir(path.resolve(dist, dir)).catch(() => []);
    const removedFiles: string[] = [];

    for(const file of files) {
      const isDirectory = await (
        fs
          .stat(path.resolve(dist, dir, file))
          .then(e => e.isDirectory())
          .catch(() => 'error' as const)
      );

      if(isDirectory === 'error') {
        removedFiles.push(file);
        continue;
      }

      if(isDirectory) {
        const isNotEmpty = await preprocessFolder(path.posix.join(dir, file));
        if(!isNotEmpty) {
          verbosePrint(`Remove empty folder "${path.posix.join(dist, dir, file)}".`);
          await fs.rmdir(path.join(dist, dir, file)).catch(() => {});
          removedFiles.push(file);
        }
        continue;
      }

      const srcFilePaths = ['.ts', '.tsx'].map(ext => path.posix.join(src, dir, file.replace(/\.(d\.ts|js)(\.map)?$/, ext)));
      const srcFiles = await Promise.all(srcFilePaths.map(async filePath => ({
        filePath,
        isFile: await (
          fs
            .stat(path.resolve(filePath))
            .then(e => e.isFile())
            .catch(e => {
              if((e as any)?.code === 'ENOENT') {
                return false;
              }
              throw e;
            })
        ),
      })));
      const srcFile = srcFiles.find(e => e.isFile);

      const distFilePath = path.posix.join(dist, dir, file);
      if(srcFile?.isFile) {
        verbosePrint(`OK: "${distFilePath}" => "${srcFile.filePath}"`);
      } else {
        verbosePrint(`No match for "${distFilePath}" in "${src}".`);
        await fs.unlink(path.resolve(dist, dir, file)).catch(() => {});
        removedFiles.push(file);
        if(!silent) {
          console.info(`REMOVED: "${distFilePath}".`);
        }
      }
    }

    return files.filter(e => !removedFiles.includes(e)).length > 0;
  };

  const watcher = debounce(debounceTime, async () => {
    await preprocessFolder();
    verbosePrint('');
    verbosePrint(`Watching for changes in "${dist}" and unlinks in "${src}".`);
  });

  switch(true) {
    case watch:
      verbosePrint('Staring watch mode.');
      chokidar.watch(path.resolve(dist))
        .on('add', watcher)
        .on('addDir', watcher)
        .on('change', watcher);
      chokidar.watch(path.resolve(src))
        .on('unlink', watcher)
        .on('unlinkDir', watcher);
      break;
    default:
      verbosePrint('Staring regular mode.');
      await preprocessFolder();
  }
};
