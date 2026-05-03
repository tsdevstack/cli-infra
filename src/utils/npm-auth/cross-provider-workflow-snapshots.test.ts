/**
 * Cross-provider workflow snapshots — locks the exact rendered YAML
 * for the user-facing workflows (deploy / PR / remove-service) under
 * `npmAuth: true`, so any future change to the env-block insertion logic
 * forces a deliberate snapshot review.
 *
 * Complementary to `cross-provider-workflow-wiring.test.ts`:
 *   - That test asserts SEMANTIC properties (parseable YAML, env at job
 *     level, value of NPM_TOKEN, cross-provider consistency).
 *   - This test locks the EXACT cosmetic shape of the output so changes
 *     are surfaced for human review even when semantics still hold.
 *
 * Scope is intentionally narrow — three workflows per provider — to keep
 * snapshots scannable.
 */
import { describe, it, expect } from '@rstest/core';
import * as gcp from '../gcp/ci';
import * as aws from '../aws/ci';
import * as azure from '../azure/ci';

const config = { provider: 'github' as const, environments: ['dev', 'prod'] };

describe('cross-provider workflow snapshots (npmAuth: true)', () => {
  describe('GCP', () => {
    it('deploy workflow snapshot', () => {
      expect(
        gcp.generateDeployWorkflow(config, { npmAuth: true }),
      ).toMatchSnapshot();
    });

    it('PR workflow snapshot', () => {
      expect(gcp.generatePrWorkflow({ npmAuth: true })).toMatchSnapshot();
    });

    it('remove-service workflow snapshot', () => {
      expect(
        gcp.generateRemoveServiceWorkflow(config, { npmAuth: true }),
      ).toMatchSnapshot();
    });
  });

  describe('AWS', () => {
    it('deploy workflow snapshot', () => {
      expect(
        aws.generateDeployWorkflow(config, { npmAuth: true }),
      ).toMatchSnapshot();
    });

    it('PR workflow snapshot', () => {
      expect(aws.generatePrWorkflow({ npmAuth: true })).toMatchSnapshot();
    });

    it('remove-service workflow snapshot', () => {
      expect(
        aws.generateRemoveServiceWorkflow(config, { npmAuth: true }),
      ).toMatchSnapshot();
    });
  });

  describe('Azure', () => {
    it('deploy workflow snapshot', () => {
      expect(
        azure.generateDeployWorkflow(config, { npmAuth: true }),
      ).toMatchSnapshot();
    });

    it('PR workflow snapshot', () => {
      expect(azure.generatePrWorkflow({ npmAuth: true })).toMatchSnapshot();
    });

    it('remove-service workflow snapshot', () => {
      expect(
        azure.generateRemoveServiceWorkflow(config, { npmAuth: true }),
      ).toMatchSnapshot();
    });
  });
});
