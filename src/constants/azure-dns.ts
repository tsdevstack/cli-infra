/**
 * Azure DNS (the zone infra:destroy lists before deleting it)
 */

/** Azure DNS REST API version (zones and record sets) */
export const AZURE_DNS_API_VERSION = '2018-05-01';

/** Longest record value infra:destroy prints (DKIM keys run to hundreds) */
export const DNS_RECORD_VALUE_DISPLAY_LENGTH = 60;
