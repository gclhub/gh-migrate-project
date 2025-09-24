import type { Octokit } from 'octokit';
import { Endpoints } from '@octokit/types';
import semver from 'semver';
import type { Logger } from './logger.js';

type DotcomMetaResponse = Endpoints['GET /meta']['response'];

// Octokit's default types target GitHub.com where there is no `installed_version` returned
// from this API. We construct our own type which includes this.
type GhesMetaResponse = DotcomMetaResponse & {
  data: {
    installed_version: string;
  };
};

export const MINIMUM_SUPPORTED_GITHUB_ENTERPRISE_SERVER_VERSION_FOR_EXPORTS = '3.14.0';

export const MINIMUM_SUPPORTED_GITHUB_ENTERPRISE_SERVER_VERSION_FOR_IMPORTS = '3.14.0';

export const MINIMUM_SUPPORTED_GITHUB_ENTERPRISE_SERVER_VERSION_FOR_STATUS_FIELD_MIGRATION =
  '3.17.0';

export enum GitHubProduct {
  GHES = 'GitHub Enterprise Server',
  DOTCOM = 'GitHub.com',
  GITHUB_ENTERPRISE_CLOUD_WITH_DATA_RESIDENCY = 'GitHub Enterprise Cloud with Data Residency',
}

export const getGitHubProductInformation = async (
  octokit: Octokit,
  logger?: Logger,
): Promise<
  | {
      githubProduct: GitHubProduct.GHES;
      gitHubEnterpriseServerVersion: string;
    }
  | {
      githubProduct:
        | GitHubProduct.DOTCOM
        | GitHubProduct.GITHUB_ENTERPRISE_CLOUD_WITH_DATA_RESIDENCY;
      gitHubEnterpriseServerVersion: undefined;
    }
> => {
  const baseUrl = octokit.request.endpoint.DEFAULTS.baseUrl;
  const githubProduct = getGitHubProductFromBaseUrl(baseUrl, logger);

  if (logger) {
    logger.debug(`GitHub product detection - baseUrl: ${baseUrl}`);
    logger.debug(`GitHub product detection - detected product: ${githubProduct}`);
  }

  if (githubProduct === GitHubProduct.GHES) {
    const gitHubEnterpriseServerVersion = await getGitHubEnterpriseServerVersion(
      octokit,
      logger,
    );

    if (logger) {
      logger.debug(
        `GitHub Enterprise Server version detected: ${gitHubEnterpriseServerVersion}`,
      );
    }

    return {
      githubProduct,
      gitHubEnterpriseServerVersion,
    };
  } else {
    if (logger) {
      logger.debug(`Non-GHES product detected, no version information needed`);
    }
    return {
      githubProduct,
      gitHubEnterpriseServerVersion: undefined,
    };
  }
};

const getGitHubProductFromBaseUrl = (baseUrl: string, logger?: Logger): GitHubProduct => {
  if (logger) {
    logger.debug(`Determining GitHub product from baseUrl: ${baseUrl}`);
  }

  if (isDotcomBaseUrl(baseUrl)) {
    if (logger) {
      logger.debug(`baseUrl matches GitHub.com pattern (https://api.github.com)`);
    }
    return GitHubProduct.DOTCOM;
  } else if (isGitHubEnterpriseCloudWithDataResidencyBaseUrl(baseUrl)) {
    if (logger) {
      const { host } = new URL(baseUrl);
      logger.debug(
        `baseUrl matches GitHub Enterprise Cloud with Data Residency pattern (host "${host}" matches pattern ^api\\.[a-zA-Z0-9-]+\\.ghe\\.com$)`,
      );
    }
    return GitHubProduct.GITHUB_ENTERPRISE_CLOUD_WITH_DATA_RESIDENCY;
  } else {
    if (logger) {
      logger.debug(
        `baseUrl does not match GitHub.com or GHEDR patterns, assuming GitHub Enterprise Server`,
      );
    }
    return GitHubProduct.GHES;
  }
};

const isDotcomBaseUrl = (baseUrl: string): boolean => {
  const result = baseUrl === 'https://api.github.com';
  return result;
};

const isGitHubEnterpriseCloudWithDataResidencyBaseUrl = (baseUrl: string): boolean => {
  try {
    const { host } = new URL(baseUrl);
    // More strict validation: ensure it ends with .ghe.com (not just ghe.com)
    // and has the expected subdomain structure for GHEDR
    const result = /^api\.[a-zA-Z0-9-]+\.ghe\.com$/.test(host);
    return result;
  } catch {
    // If URL parsing fails, it's not a valid URL, so it can't be GHEDR
    return false;
  }
};

const getGitHubEnterpriseServerVersion = async (
  octokit: Octokit,
  logger?: Logger,
): Promise<string> => {
  if (logger) {
    logger.debug(`Fetching GitHub Enterprise Server version from API`);
  }

  const metaResponse = (await octokit.rest.meta.get()) as GhesMetaResponse;
  const installed_version = metaResponse.data.installed_version;

  if (logger) {
    logger.debug(`Raw API response for installed_version: "${installed_version}"`);
    logger.debug(`Type of installed_version: ${typeof installed_version}`);
  }

  return installed_version;
};

export const supportsAutomaticStatusFieldMigration = (
  githubProduct: GitHubProduct,
  gitHubEnterpriseServerVersion?: string,
  logger?: Logger,
): boolean => {
  if (logger) {
    logger.debug(`Checking automatic Status field migration support`);
    logger.debug(`GitHub product: ${githubProduct}`);
    logger.debug(`GHES version: ${gitHubEnterpriseServerVersion || 'undefined'}`);
    logger.debug(
      `Minimum required GHES version: ${MINIMUM_SUPPORTED_GITHUB_ENTERPRISE_SERVER_VERSION_FOR_STATUS_FIELD_MIGRATION}`,
    );
  }

  // GitHub.com and GitHub Enterprise Cloud with Data Residency always support it
  if (githubProduct !== GitHubProduct.GHES) {
    if (logger) {
      logger.debug(
        `Non-GHES product detected, automatic Status field migration is supported`,
      );
    }
    return true;
  }

  // For GHES, check if version is 3.17.0 or later
  if (!gitHubEnterpriseServerVersion) {
    if (logger) {
      logger.debug(
        `GHES detected but no version information available, automatic Status field migration NOT supported`,
      );
    }
    return false;
  }

  try {
    const isSupported = semver.gte(
      gitHubEnterpriseServerVersion,
      MINIMUM_SUPPORTED_GITHUB_ENTERPRISE_SERVER_VERSION_FOR_STATUS_FIELD_MIGRATION,
    );

    if (logger) {
      logger.debug(
        `semver.gte("${gitHubEnterpriseServerVersion}", "${MINIMUM_SUPPORTED_GITHUB_ENTERPRISE_SERVER_VERSION_FOR_STATUS_FIELD_MIGRATION}") = ${isSupported}`,
      );
      logger.debug(
        `Automatic Status field migration is ${isSupported ? 'SUPPORTED' : 'NOT SUPPORTED'}`,
      );
    }

    return isSupported;
  } catch (error) {
    if (logger) {
      logger.debug(
        `Error parsing version "${gitHubEnterpriseServerVersion}": ${error.message}`,
      );
      logger.debug(
        `Due to version parsing error, automatic Status field migration NOT supported`,
      );
    }
    // If we can't parse the version, assume it's not supported for safety
    return false;
  }
};
