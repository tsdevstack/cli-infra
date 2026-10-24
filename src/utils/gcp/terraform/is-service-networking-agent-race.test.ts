import { describe, it, expect } from '@rstest/core';
import { isServiceNetworkingAgentRace } from './is-service-networking-agent-race';

// Terraform's output from the first GCP round deploy (2026-10-23)
const RACE = [
  'google_compute_global_forwarding_rule.https_ipv6: Creation complete after 32s',
  '╷',
  '│ Error: Error waiting for Create Service Networking Connection: Error code 16, message: Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.',
  '│ Help Token: abc',
  '│',
  '│   with google_service_networking_connection.private_service_connection,',
  '│   on network.tf line 32, in resource "google_service_networking_connection" "private_service_connection":',
  '╵',
].join('\n');

describe('isServiceNetworkingAgentRace', () => {
  describe('Standard use cases', () => {
    it('should recognize the first-deploy Service Networking failure', () => {
      expect(isServiceNetworkingAgentRace(RACE)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should not match when another error failed too', () => {
      const output = `${RACE}\n╷\n│ Error: googleapi: Error 409: The requested bucket name is not available.\n╵`;

      expect(isServiceNetworkingAgentRace(output)).toBe(false);
    });

    it('should not match other Service Networking errors', () => {
      expect(
        isServiceNetworkingAgentRace(
          '│ Error: Error waiting for Create Service Networking Connection: Error code 9, message: Cannot modify allocated ranges',
        ),
      ).toBe(false);
    });

    it('should not match an authentication error elsewhere', () => {
      expect(
        isServiceNetworkingAgentRace(
          '│ Error: Error creating Network: Error code 16, invalid authentication credentials',
        ),
      ).toBe(false);
    });

    it('should not match output without errors', () => {
      expect(isServiceNetworkingAgentRace('Apply complete!')).toBe(false);
    });
  });
});
