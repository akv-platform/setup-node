import * as core from '@actions/core';
import * as cache from '@actions/cache';
import path from 'path';
import * as utils from '../src/cache-utils';
import {
  PackageManagerInfo,
  isCacheFeatureAvailable,
  supportedPackageManagers
} from '../src/cache-utils';
import fs from 'fs';
import * as cacheUtils from '../src/cache-utils';
import * as glob from '@actions/glob';
import {Globber} from '@actions/glob';
import {MockGlobber} from './mock/glob-mock';

describe('cache-utils', () => {
  const versionYarn1 = '1.2.3';

  let debugSpy: jest.SpyInstance;
  let getCommandOutputSpy: jest.SpyInstance;
  let isFeatureAvailable: jest.SpyInstance;
  let info: jest.SpyInstance;
  let warningSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['GITHUB_WORKSPACE'] = path.join(__dirname, 'data');
    debugSpy = jest.spyOn(core, 'debug');
    debugSpy.mockImplementation(msg => {});

    info = jest.spyOn(core, 'info');
    warningSpy = jest.spyOn(core, 'warning');

    isFeatureAvailable = jest.spyOn(cache, 'isFeatureAvailable');

    getCommandOutputSpy = jest.spyOn(utils, 'getCommandOutput');
  });

  describe('getPackageManagerInfo', () => {
    it.each<[string, PackageManagerInfo | null]>([
      ['npm', utils.supportedPackageManagers.npm],
      ['pnpm', utils.supportedPackageManagers.pnpm],
      ['yarn', utils.supportedPackageManagers.yarn],
      ['yarn1', null],
      ['yarn2', null],
      ['npm7', null]
    ])('getPackageManagerInfo for %s is %o', async (packageManager, result) => {
      getCommandOutputSpy.mockImplementationOnce(() => versionYarn1);
      await expect(utils.getPackageManagerInfo(packageManager)).resolves.toBe(
        result
      );
    });
  });

  it('isCacheFeatureAvailable for GHES is false', () => {
    isFeatureAvailable.mockImplementation(() => false);
    process.env['GITHUB_SERVER_URL'] = 'https://www.test.com';

    expect(isCacheFeatureAvailable()).toBeFalsy();
    expect(warningSpy).toHaveBeenCalledWith(
      'Cache action is only supported on GHES version >= 3.5. If you are on version >=3.5 Please check with GHES admin if Actions cache service is enabled or not.'
    );
  });

  it('isCacheFeatureAvailable for GHES has an interhal error', () => {
    isFeatureAvailable.mockImplementation(() => false);
    process.env['GITHUB_SERVER_URL'] = '';
    isCacheFeatureAvailable();
    expect(warningSpy).toHaveBeenCalledWith(
      'The runner was not able to contact the cache service. Caching will be skipped'
    );
  });

  it('isCacheFeatureAvailable for GHES is available', () => {
    isFeatureAvailable.mockImplementation(() => true);

    expect(isCacheFeatureAvailable()).toStrictEqual(true);
  });

  afterEach(() => {
    process.env['GITHUB_SERVER_URL'] = '';
    jest.resetAllMocks();
    jest.clearAllMocks();
  });

  describe('getCacheDirectoriesPaths', () => {
    let existsSpy: jest.SpyInstance;
    let lstatSpy: jest.SpyInstance;
    let globCreateSpy: jest.SpyInstance;

    beforeEach(() => {
      existsSpy = jest.spyOn(fs, 'existsSync');
      existsSpy.mockImplementation(() => true);

      lstatSpy = jest.spyOn(fs, 'lstatSync');
      lstatSpy.mockImplementation(arg => ({
        isDirectory: () => true
      }));

      globCreateSpy = jest.spyOn(glob, 'create');
      globCreateSpy.mockImplementation(
        (pattern: string): Promise<Globber> =>
          MockGlobber.create(['/foo', '/bar'])
      );
    });

    afterEach(() => {
      existsSpy.mockRestore();
      lstatSpy.mockRestore();
      globCreateSpy.mockRestore();
    });

    it.each([
      [supportedPackageManagers.npm, ''],
      [supportedPackageManagers.npm, '/dir/file.lock'],
      [supportedPackageManagers.npm, '/**/file.lock'],
      [supportedPackageManagers.pnpm, ''],
      [supportedPackageManagers.pnpm, '/dir/file.lock'],
      [supportedPackageManagers.pnpm, '/**/file.lock']
    ])(
      'getCacheDirectoriesPaths should return one dir for non yarn',
      async (packageManagerInfo, cacheDependency) => {
        getCommandOutputSpy.mockImplementation(() => 'foo');

        const dirs = await cacheUtils.getCacheDirectoriesPaths(
          packageManagerInfo,
          cacheDependency
        );
        expect(dirs).toEqual(['foo']);
      }
    );

    it('getCacheDirectoriesPaths should return one dir for yarn without cacheDependency', async () => {
      getCommandOutputSpy.mockImplementation(() => 'foo');

      const dirs = await cacheUtils.getCacheDirectoriesPaths(
        supportedPackageManagers.yarn,
        ''
      );
      expect(dirs).toEqual(['foo']);
    });

    it.each([
      [supportedPackageManagers.npm, ''],
      [supportedPackageManagers.npm, '/dir/file.lock'],
      [supportedPackageManagers.npm, '/**/file.lock'],
      [supportedPackageManagers.pnpm, ''],
      [supportedPackageManagers.pnpm, '/dir/file.lock'],
      [supportedPackageManagers.pnpm, '/**/file.lock'],
      [supportedPackageManagers.yarn, ''],
      [supportedPackageManagers.yarn, '/dir/file.lock'],
      [supportedPackageManagers.yarn, '/**/file.lock']
    ])(
      'getCacheDirectoriesPaths should return empty array of folder in case of error for $glob',
      async (packageManagerInfo, cacheDependency) => {
        getCommandOutputSpy.mockImplementation((command: string) =>
          command.includes('version') ? '1.' : ''
        );
        lstatSpy.mockImplementation(arg => ({
          isDirectory: () => false
        }));

        await expect(
          cacheUtils.getCacheDirectoriesPaths(
            packageManagerInfo,
            cacheDependency
          )
        ).rejects.toThrow(); //'Could not get cache folder path for /dir');
      }
    );

    it.each(['1.1.1', '2.2.2'])(
      'getCacheDirectoriesPaths should return one dir for yarn v%s with single cacheDependency',
      async version => {
        getCommandOutputSpy.mockImplementationOnce(() => version);
        getCommandOutputSpy.mockImplementationOnce(() => `foo${version}`);

        const dirs = await cacheUtils.getCacheDirectoriesPaths(
          supportedPackageManagers.yarn,
          ''
        );
        expect(dirs).toEqual([`foo${version}`]);
      }
    );

    it.each(['1.1.1', '2.2.2'])(
      'getCacheDirectoriesPaths should return 2 dirs for yarn v%s with globbed cacheDependency',
      async version => {
        let dirNo = 1;
        getCommandOutputSpy.mockImplementation((command: string) =>
          command.includes('version') ? version : `file_${version}_${dirNo++}`
        );
        globCreateSpy.mockImplementation(
          (pattern: string): Promise<Globber> =>
            MockGlobber.create(['/tmp/dir1/file', '/tmp/dir2/file'])
        );

        const dirs = await cacheUtils.getCacheDirectoriesPaths(
          supportedPackageManagers.yarn,
          '/tmp/**/file'
        );
        expect(dirs).toEqual([`file_${version}_1`, `file_${version}_2`]);
      }
    );

    // TODO: by design - glob is not expected to return duplicates so do not handle the case
    it.each(['1.1.1', '2.2.2'])(
      'getCacheDirectoriesPaths should return 3 dirs for yarn v%s with globbed cacheDependency expanding to duplicates',
      async version => {
        let dirNo = 1;
        getCommandOutputSpy.mockImplementation((command: string) =>
          command.includes('version') ? version : `file_${version}_${dirNo++}`
        );
        globCreateSpy.mockImplementation(
          (pattern: string): Promise<Globber> =>
            MockGlobber.create([
              '/tmp/dir1/file',
              '/tmp/dir2/file',
              '/tmp/dir1/file'
            ])
        );

        const dirs = await cacheUtils.getCacheDirectoriesPaths(
          supportedPackageManagers.yarn,
          '/tmp/**/file'
        );
        expect(dirs).toEqual([`file_${version}_1`, `file_${version}_2`]);
      }
    );

    it.each(['1.1.1', '2.2.2'])(
      'getCacheDirectoriesPaths should return 2 dirs for yarn v%s with globbed cacheDependency despite dup cache directories',
      async version => {
        let dirNo = 1;
        getCommandOutputSpy.mockImplementation((command: string) =>
          command.includes('version')
            ? version
            : `file_${version}_${dirNo++ % 2}`
        );
        globCreateSpy.mockImplementation(
          (pattern: string): Promise<Globber> =>
            MockGlobber.create([
              '/tmp/dir1/file',
              '/tmp/dir2/file',
              '/tmp/dir3/file'
            ])
        );

        const dirs = await cacheUtils.getCacheDirectoriesPaths(
          supportedPackageManagers.yarn,
          '/tmp/**/file'
        );
        expect(dirs).toEqual([`file_${version}_1`, `file_${version}_0`]);
      }
    );
  });
});
