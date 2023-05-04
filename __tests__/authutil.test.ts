import os from 'os';
import fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as auth from '../src/authutil';
import * as cacheUtils from '../src/cache-utils';

let rcFile: string;

describe('authutil tests', () => {
  const _runnerDir = path.join(__dirname, 'runner');

  let cnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let dbgSpy: jest.SpyInstance;

  beforeAll(async () => {
    const randPath = path.join(Math.random().toString(36).substring(7));
    console.log('::stop-commands::stoptoken'); // Disable executing of runner commands when running tests in actions
    process.env['GITHUB_ENV'] = ''; // Stub out Environment file functionality so we can verify it writes to standard out (toolkit is backwards compatible)
    const tempDir = path.join(_runnerDir, randPath, 'temp');
    await io.rmRF(tempDir);
    await io.mkdirP(tempDir);
    process.env['GITHUB_REPOSITORY'] = 'OwnerName/repo';
    process.env['RUNNER_TEMP'] = tempDir;
    rcFile = path.join(tempDir, '.npmrc');
  }, 100000);

  beforeEach(async () => {
    await io.rmRF(rcFile);
    // if (fs.existsSync(rcFile)) {
    //   fs.unlinkSync(rcFile);
    // }
    process.env['INPUT_SCOPE'] = '';

    // writes
    cnSpy = jest.spyOn(process.stdout, 'write');
    logSpy = jest.spyOn(console, 'log');
    dbgSpy = jest.spyOn(core, 'debug');
    cnSpy.mockImplementation(line => {
      // uncomment to debug
      // process.stderr.write('write:' + line + '\n');
    });
    logSpy.mockImplementation(line => {
      // uncomment to debug
      // process.stderr.write('log:' + line + '\n');
    });
    dbgSpy.mockImplementation(msg => {
      // uncomment to see debug output
      // process.stderr.write(msg + '\n');
    });
  }, 100000);

  function dbg(message: string) {
    process.stderr.write('dbg::' + message + '::\n');
  }

  afterAll(async () => {
    if (_runnerDir) {
      await io.rmRF(_runnerDir);
    }
    console.log('::stoptoken::'); // Re-enable executing of runner commands when running tests in actions
  }, 100000);

  function readRcFile(rcFile: string) {
    const rc = {};
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    for (const line of contents.split(os.EOL)) {
      const parts = line.split('=');
      if (parts.length == 2) {
        rc[parts[0].trim()] = parts[1].trim();
      }
    }
    return rc;
  }

  it('Sets up npmrc for npmjs', async () => {
    await auth.configAuthentication('https://registry.npmjs.org/', 'false');

    expect(fs.statSync(rcFile)).toBeDefined();
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    const rc = readRcFile(rcFile);
    expect(rc['registry']).toBe('https://registry.npmjs.org/');
    expect(rc['always-auth']).toBe('false');
  });

  it('Appends trailing slash to registry', async () => {
    await auth.configAuthentication('https://registry.npmjs.org', 'false');

    expect(fs.statSync(rcFile)).toBeDefined();
    const rc = readRcFile(rcFile);
    expect(rc['registry']).toBe('https://registry.npmjs.org/');
    expect(rc['always-auth']).toBe('false');
  });

  it('Configures scoped npm registries', async () => {
    process.env['INPUT_SCOPE'] = 'myScope';
    await auth.configAuthentication('https://registry.npmjs.org', 'false');

    expect(fs.statSync(rcFile)).toBeDefined();
    const rc = readRcFile(rcFile);
    expect(rc['@myscope:registry']).toBe('https://registry.npmjs.org/');
    expect(rc['always-auth']).toBe('false');
  });

  it('Automatically configures GPR scope', async () => {
    await auth.configAuthentication('npm.pkg.github.com', 'false');

    expect(fs.statSync(rcFile)).toBeDefined();
    const rc = readRcFile(rcFile);
    expect(rc['@ownername:registry']).toBe('npm.pkg.github.com/');
    expect(rc['always-auth']).toBe('false');
  });

  it('Sets up npmrc for always-auth true', async () => {
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    expect(fs.statSync(rcFile)).toBeDefined();
    const rc = readRcFile(rcFile);
    expect(rc['registry']).toBe('https://registry.npmjs.org/');
    expect(rc['always-auth']).toBe('true');
  });

  it('is already set the NODE_AUTH_TOKEN export it', async () => {
    process.env.NODE_AUTH_TOKEN = 'foobar';
    await auth.configAuthentication('npm.pkg.github.com', 'false');
    expect(fs.statSync(rcFile)).toBeDefined();
    const rc = readRcFile(rcFile);
    expect(rc['@ownername:registry']).toBe('npm.pkg.github.com/');
    expect(rc['always-auth']).toBe('false');
    expect(process.env.NODE_AUTH_TOKEN).toEqual('foobar');
  });

  it('configAuthentication should overwrite non-scoped with non-scoped', async () => {
    fs.writeFileSync(rcFile, 'registry=NNN');
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should overwrite only non-scoped', async () => {
    fs.writeFileSync(rcFile, `registry=NNN${os.EOL}@myscope:registry=MMM`);
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `@myscope:registry=MMM${os.EOL}//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should add non-scoped to scoped', async () => {
    fs.writeFileSync(rcFile, '@myscope:registry=NNN');
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `@myscope:registry=NNN${os.EOL}//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should overwrite scoped with scoped', async () => {
    process.env['INPUT_SCOPE'] = 'myscope';
    fs.writeFileSync(rcFile, `@myscope:registry=NNN`);
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}@myscope:registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should overwrite only scoped', async () => {
    process.env['INPUT_SCOPE'] = 'myscope';
    fs.writeFileSync(rcFile, `registry=NNN${os.EOL}@myscope:registry=MMM`);
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `registry=NNN${os.EOL}//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}@myscope:registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should add scoped to non-scoped', async () => {
    process.env['INPUT_SCOPE'] = 'myscope';
    fs.writeFileSync(rcFile, `registry=MMM`);
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `registry=MMM${os.EOL}//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}@myscope:registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should overwrite only one scoped', async () => {
    process.env['INPUT_SCOPE'] = 'myscope';
    fs.writeFileSync(
      rcFile,
      `@otherscope:registry=NNN${os.EOL}@myscope:registry=MMM`
    );
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `@otherscope:registry=NNN${os.EOL}//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}@myscope:registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  it('configAuthentication should add scoped to another scoped', async () => {
    process.env['INPUT_SCOPE'] = 'myscope';
    fs.writeFileSync(rcFile, `@otherscope:registry=MMM`);
    await auth.configAuthentication('https://registry.npmjs.org/', 'true');
    const contents = fs.readFileSync(rcFile, {encoding: 'utf8'});
    expect(contents).toBe(
      `@otherscope:registry=MMM${os.EOL}//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}${os.EOL}@myscope:registry=https://registry.npmjs.org/${os.EOL}always-auth=true`
    );
  });

  describe('getPackageManagerWorkingDir', () => {
    let existsSpy: jest.SpyInstance;
    let lstatSpy: jest.SpyInstance;

    beforeEach(() => {
      existsSpy = jest.spyOn(fs, 'existsSync');
      existsSpy.mockImplementation(() => true);

      lstatSpy = jest.spyOn(fs, 'lstatSync');
      lstatSpy.mockImplementation(arg => ({
        isDirectory: () => true
      }));
    });

    afterEach(() => {
      existsSpy.mockRestore();
      lstatSpy.mockRestore();
    });

    it('getPackageManagerWorkingDir should return null for not yarn', async () => {
      process.env['INPUT_CACHE'] = 'some';
      delete process.env['INPUT_CACHE-DEPENDENCY-PATH'];
      const dir = cacheUtils.getPackageManagerWorkingDir();
      expect(dir).toBeNull();
    });

    it('getPackageManagerWorkingDir should return null for not yarn with cache-dependency-path', async () => {
      process.env['INPUT_CACHE'] = 'some';
      process.env['INPUT_CACHE-DEPENDENCY-PATH'] = '/foo/bar';
      const dir = cacheUtils.getPackageManagerWorkingDir();
      expect(dir).toBeNull();
    });

    it('getPackageManagerWorkingDir should return null for yarn but without cache-dependency-path', async () => {
      process.env['INPUT_CACHE'] = 'yarn';
      delete process.env['INPUT_CACHE-DEPENDENCY-PATH'];
      const dir = cacheUtils.getPackageManagerWorkingDir();
      expect(dir).toBeNull();
    });

    it('getPackageManagerWorkingDir should return null for yarn with cache-dependency-path for not-existing directory', async () => {
      process.env['INPUT_CACHE'] = 'yarn';
      const cachePath = '/foo/bar';
      process.env['INPUT_CACHE-DEPENDENCY-PATH'] = cachePath;
      lstatSpy.mockImplementation(arg => ({
        isDirectory: () => false
      }));
      const dir = cacheUtils.getPackageManagerWorkingDir();
      expect(dir).toBeNull();
    });

    it('getPackageManagerWorkingDir should return path for yarn with cache-dependency-path', async () => {
      process.env['INPUT_CACHE'] = 'yarn';
      const cachePath = '/foo/bar';
      process.env['INPUT_CACHE-DEPENDENCY-PATH'] = cachePath;
      const dir = cacheUtils.getPackageManagerWorkingDir();
      expect(dir).toEqual(path.dirname(cachePath));
    });

    it('getCommandOutput(getPackageManagerVersion) should be called from  with getPackageManagerWorkingDir result', async () => {
      process.env['INPUT_CACHE'] = 'yarn';
      const cachePath = '/foo/bar';
      process.env['INPUT_CACHE-DEPENDENCY-PATH'] = cachePath;
      const getCommandOutputSpy = jest
        .spyOn(cacheUtils, 'getCommandOutput')
        .mockReturnValue(Promise.resolve('baz'));

      const version = await cacheUtils.getPackageManagerVersion('foo', 'bar');
      expect(getCommandOutputSpy).toHaveBeenCalledWith(
        `foo bar`,
        path.dirname(cachePath)
      );
    });

    it('getCommandOutput(getCacheDirectoryPath) should be called from  with getPackageManagerWorkingDir result', async () => {
      process.env['INPUT_CACHE'] = 'yarn';
      const cachePath = '/foo/bar';
      process.env['INPUT_CACHE-DEPENDENCY-PATH'] = cachePath;
      const getCommandOutputSpy = jest
        .spyOn(cacheUtils, 'getCommandOutput')
        .mockReturnValue(Promise.resolve('baz'));

      const version = await cacheUtils.getCacheDirectoryPath(
        {lockFilePatterns: [], getCacheFolderCommand: 'quz'},
        ''
      );
      expect(getCommandOutputSpy).toHaveBeenCalledWith(
        `quz`,
        path.dirname(cachePath)
      );
    });
  });
});
