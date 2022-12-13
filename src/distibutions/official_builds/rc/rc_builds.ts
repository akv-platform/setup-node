import * as core from '@actions/core';

import * as semver from 'semver';

import BaseDistribution from '../../base-distribution';
import {INodejs, INodeVersion} from '../../base-models';

export default class RcBuild extends BaseDistribution {
  constructor(nodeInfo: INodejs) {
    super(nodeInfo);
  }

  protected async getNodejsVersions(): Promise<INodeVersion[]> {
    const initialUrl = this.getDistributionUrl();
    const dataUrl = `${initialUrl}/index.json`;

    let response = await this.httpClient.getJson<INodeVersion[]>(dataUrl);
    return response.result || [];
  }

  protected evaluateVersions(nodeVersions: INodeVersion[]): string {
    let version = '';
    const versions = this.filterVersions(nodeVersions);
    core.debug(`evaluating ${versions.length} versions`);

    for (let i = versions.length - 1; i >= 0; i--) {
      const potential: string = versions[i];
      const satisfied: boolean = semver.satisfies(
        potential,
        this.nodeInfo.versionSpec
      );
      if (satisfied) {
        version = potential;
        break;
      }
    }

    if (version) {
      core.debug(`matched: ${version}`);
    } else {
      core.debug('match not found');
    }

    return version;
  }

  getDistributionUrl(): string {
    return 'https://nodejs.org/download/rc';
  }
}