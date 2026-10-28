/**
 * Collect the DNS records a GCP load balancer needs at the registrar
 */

import {
  getTerraformOutput,
  getTerraformOutputJson,
  toDnsAuthName,
} from '../terraform';
import { toTerraformId } from '../../terraform';
import type { DnsRecord } from './types';

/**
 * The records the maintainer sets at the domain's registrar: A and AAAA for
 * every host the load balancer serves, and Certificate Manager's CNAMEs,
 * which stay in place because certificate renewals use them too.
 *
 * @param options.terraformDir - Terraform directory of the environment
 * @param options.tfEnv - Environment for Terraform commands
 * @param options.apiDomain - The API domain
 * @param options.frontendServices - Frontends with their domains
 * @param options.redirectDomains - Domains that redirect to the main one
 * @returns The load balancer's IP and the records
 * @throws When the state has no load balancer
 */
export function collectLoadBalancerDnsRecords(options: {
  terraformDir: string;
  tfEnv: Record<string, string>;
  apiDomain: string;
  frontendServices: ReadonlyArray<{ name: string; domain: string }>;
  redirectDomains?: readonly string[];
}): { lbIp: string; records: DnsRecord[] } {
  const {
    terraformDir,
    tfEnv,
    apiDomain,
    frontendServices,
    redirectDomains = [],
  } = options;

  const lbIp = getTerraformOutput(terraformDir, 'load_balancer_ip', tfEnv);
  const hosts = [
    apiDomain,
    ...frontendServices.map((service) => service.domain),
    ...redirectDomains.flatMap((domain) => [domain, `*.${domain}`]),
  ];
  const records: DnsRecord[] = hosts.map((host) => ({
    type: 'A',
    host,
    value: lbIp,
  }));

  // A state from before the IPv6 address has no such output
  try {
    const ipv6 = getTerraformOutput(terraformDir, 'load_balancer_ipv6', tfEnv);
    if (ipv6) {
      records.push(
        ...hosts.map((host) => ({ type: 'AAAA' as const, host, value: ipv6 })),
      );
    }
  } catch {
    // No IPv6 address yet
  }

  const authOutputs = [
    'dns_auth_api_record',
    ...frontendServices.map(
      (service) => `dns_auth_${toTerraformId(service.name)}_record`,
    ),
    ...redirectDomains.map(
      (domain) =>
        `dns_auth_redirect_${toTerraformId(toDnsAuthName(domain))}_record`,
    ),
  ];
  try {
    for (const output of authOutputs) {
      const auth = getTerraformOutputJson<{ name: string; data: string }>(
        terraformDir,
        output,
        tfEnv,
      );
      records.push({ type: 'CNAME', host: auth.name, value: auth.data });
    }
  } catch {
    // A state without DNS authorizations
  }

  return { lbIp, records };
}
