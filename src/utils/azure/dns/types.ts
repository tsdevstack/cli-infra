/**
 * Azure DNS record sets, as the REST API returns them (only the fields the
 * CLI reads)
 */
export interface AzureDnsRecordSet {
  /** Relative name: "@" for the apex, "send", "_dnsauth.api" */
  name: string;
  /** "Microsoft.Network/dnszones/MX" */
  type: string;
  properties?: {
    ARecords?: { ipv4Address?: string }[];
    AAAARecords?: { ipv6Address?: string }[];
    CNAMERecord?: { cname?: string };
    MXRecords?: { preference?: number; exchange?: string }[];
    TXTRecords?: { value?: string[] }[];
    NSRecords?: { nsdname?: string }[];
    CAARecords?: { flags?: number; tag?: string; value?: string }[];
    SRVRecords?: {
      priority?: number;
      weight?: number;
      port?: number;
      target?: string;
    }[];
    PTRRecords?: { ptrdname?: string }[];
    /** Alias record: the Azure resource it points to */
    targetResource?: { id?: string };
  };
}

/** A record in the zone that the framework didn't make */
export interface HandAddedDnsRecord {
  name: string;
  /** Record type: MX, TXT, CNAME... */
  type: string;
  /** Values as people write them: "10 feedback-smtp.example.com" */
  values: string[];
}

/** A framework DNS zone and the records in it the framework didn't make */
export interface HandAddedDnsRecords {
  zone: string;
  records: HandAddedDnsRecord[];
}
