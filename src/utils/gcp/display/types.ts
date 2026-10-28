/**
 * Types for the DNS records a GCP load balancer needs at the registrar
 */

/** One DNS record: its type, the host it is set on, and the expected value */
export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME';
  host: string;
  value: string;
}
