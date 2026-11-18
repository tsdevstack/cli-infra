/**
 * Line shapes from az6's Kudu streams (2026-11-18), addresses and ids made up
 */

import { describe, it, expect } from '@rstest/core';
import type { LogSource } from '../../logs/types';
import { parseAzureKuduStreamLine } from './parse-azure-kudu-stream-line';

const kong: LogSource = { name: 'kong', type: 'kong' };
const frontend: LogSource = { name: 'frontend', type: 'frontend' };

describe('parseAzureKuduStreamLine', () => {
  describe('Standard use cases', () => {
    it("should turn Kong's access line into an app line at its own time", () => {
      const line =
        '2026-11-18T07:46:14.4083994Z 203.0.113.7 - - [18/Nov/2026:07:46:14 +0000] "GET /auth/v1/health HTTP/1.1" 404 103 "-" "node"';

      const entry = parseAzureKuduStreamLine(line, kong);

      expect(entry).toMatchObject({
        time: '2026-11-18T07:46:14.408Z',
        source: 'kong',
        kind: 'app',
        message:
          '203.0.113.7 - - [18/Nov/2026:07:46:14 +0000] "GET /auth/v1/health HTTP/1.1" 404 103 "-" "node"',
        raw: line,
      });
      expect(entry?.level).toBeUndefined();
    });

    it("should read the app's JSON lines like Log Analytics rows", () => {
      const entry = parseAzureKuduStreamLine(
        '2026-11-18T07:50:00.1234567Z {"level":50,"msg":"Request failed","context":"Page"}',
        frontend,
      );

      expect(entry).toMatchObject({
        kind: 'app',
        level: 'error',
        message: 'Request failed',
      });
    });

    it("should keep Next.js' plain lines as app lines", () => {
      expect(
        parseAzureKuduStreamLine(
          '2026-11-18T07:06:46.6350186Z ✓ Ready in 0ms',
          frontend,
        ),
      ).toMatchObject({ kind: 'app', message: '✓ Ready in 0ms' });
    });

    it("should mark App Service's events as platform lines", () => {
      for (const text of [
        'Container is running.',
        'Container start method called.',
        'Site started.',
        'Site: shop-dev-kong stopped.',
        'Site container: shop-dev-kong terminated during site startup.',
        'Stopping container: 6634e9c4819c_shop-dev-kong_main.',
        'Establishing network.',
        'Pulling image: shopacr.azurecr.io/kong:latest.',
        'State: Starting, Action: PullingImage, LastError: , LastErrorTimestamp: 11/18/2026 06:40:00, LastErrorDetails: , Details: Pulling image',
        'INFO  - Pull Image successful, Time taken: 3 Seconds',
      ]) {
        expect(
          parseAzureKuduStreamLine(`2026-11-18T07:36:13.9327103Z ${text}`, kong)
            ?.kind,
        ).toBe('platform');
      }
    });

    it('should give a platform line the level of its own prefix, without the prefix', () => {
      expect(
        parseAzureKuduStreamLine(
          '2026-11-18T07:36:13.9327103Z WARN  - Image pull failed. Defaulting to local copy if present.',
          kong,
        ),
      ).toMatchObject({
        kind: 'platform',
        level: 'warn',
        message: 'Image pull failed. Defaulting to local copy if present.',
      });
    });

    it('should make failures without a prefix errors, the other events info', () => {
      const level = (text: string): string | undefined =>
        parseAzureKuduStreamLine(`2026-11-18T07:36:13.9327103Z ${text}`, kong)
          ?.level;

      expect(level('Failed to start site. Revert by stopping site.')).toBe(
        'error',
      );
      expect(
        level(
          'State: Blocked, Action: None, LastError: ImageNotFoundFailure, LastErrorTimestamp: 11/18/2026 06:40:00',
        ),
      ).toBe('error');
      expect(
        level('Site container: shop-dev-kong terminated during site startup.'),
      ).toBe('error');
      expect(level('Container is running.')).toBe('info');
      expect(level('Site: shop-dev-kong is unblocked.')).toBe('info');
      expect(
        level(
          'State: Starting, Action: PullingImage, LastError: , LastErrorTimestamp: 11/18/2026 06:40:00',
        ),
      ).toBe('info');
    });
  });

  describe('Edge cases', () => {
    it("should leave out Kudu's own trace, welcome, markers and file headers", () => {
      for (const line of [
        '2026-11-18T07:46:30    Error occurred, type: error, text: LogStreamManager: ProcessRequest end',
        '2026-11-18T07:45:30  Welcome, you are now connected to log-streaming service.',
        'Starting Live Log Stream ---',
        '/home/LogFiles/2026_11_18_lw0mdlwk0000CA_default_docker.log  (https://shop-dev-kong.scm.azurewebsites.net/api/vfs/LogFiles/2026_11_18_lw0mdlwk0000CA_default_docker.log)',
        '11/18/2026 06:41:39',
      ]) {
        expect(parseAzureKuduStreamLine(line, kong)).toBeUndefined();
      }
    });

    it("should leave out the lines of Kudu's own container", () => {
      for (const text of [
        'log4net:ERROR Appender named [DeploymentLogAppender] not found.',
        'Startup : 07.35.26.432641',
        'Configure Services : 07.35.26.484160',
        'Hosting environment: Production',
        'Content root path: /opt/Kudu',
        'Now listening on: http://169.254.129.2:8181',
        'Application started. Press Ctrl+C to shut down.',
      ]) {
        expect(
          parseAzureKuduStreamLine(
            `2026-11-18T07:35:25.9891470Z ${text}`,
            kong,
          ),
        ).toBeUndefined();
      }
    });

    it('should leave out an empty line and keep a CRLF line', () => {
      expect(
        parseAzureKuduStreamLine('2026-11-18T07:35:25.9891470Z ', kong),
      ).toBeUndefined();
      expect(
        parseAzureKuduStreamLine('2026-11-18T07:35:25.9891470Z hello\r', kong)
          ?.message,
      ).toBe('hello');
    });
  });
});
