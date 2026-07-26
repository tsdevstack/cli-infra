/**
 * Cross-provider NPM_TOKEN wiring — structural integration test.
 *
 * Goal: catch any structural break (YAML indentation, env block placement,
 * cross-provider divergence) introduced by the npm-auth feature, in ONE
 * place. If you change `renderJobEnvBlock` or the YAML insertion site in
 * any provider's generator, this is the test that fails first.
 *
 * Strategy: import every key workflow generator across all three
 * providers, render in both `npmAuth: false` and `npmAuth: true` modes,
 * parse the YAML with js-yaml, and assert:
 *   - YAML parses without error in both modes (rules out indentation breaks).
 *   - `npmAuth: false` → no NPM_TOKEN appears anywhere.
 *   - `npmAuth: true`  → exactly one NPM_TOKEN entry at the JOB-level
 *     `env:` block (not step-level), value is `${{ secrets.NPM_TOKEN }}`.
 *
 * The same assertions run uniformly across GCP / AWS / Azure, so any
 * divergence between providers shows up immediately.
 */
import { describe, it, expect } from '@rstest/core';
import * as yaml from 'js-yaml';

import * as gcp from '../gcp/ci';
import * as aws from '../aws/ci';
import * as azure from '../azure/ci';

const config = { provider: 'github' as const, environments: ['dev', 'prod'] };
const services = [
  { name: 'auth-service', type: 'nestjs' },
  { name: 'frontend', type: 'nextjs' },
];

interface JobShape {
  // GitHub Actions job — the relevant subset
  'runs-on'?: string;
  permissions?: unknown;
  env?: Record<string, string>;
  steps: Array<{ env?: Record<string, string> }>;
}
interface WorkflowShape {
  name: string;
  jobs: Record<string, JobShape>;
}

function findFirstJob(workflow: unknown): JobShape {
  const wf = workflow as WorkflowShape;
  const jobName = Object.keys(wf.jobs)[0]!;
  return wf.jobs[jobName]!;
}

interface Case {
  provider: 'gcp' | 'aws' | 'azure';
  name: string;
  render: (npmAuth: boolean) => string;
}

const cases: Case[] = [
  // GCP — every workflow generator
  {
    provider: 'gcp',
    name: 'deploy',
    render: (npmAuth) => gcp.generateDeployWorkflow(config, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'deploy-services',
    render: (npmAuth) =>
      gcp.generateDeployServicesWorkflow(config, services, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'deploy-infra',
    render: (npmAuth) => gcp.generateDeployInfraWorkflow(config, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'deploy-kong',
    render: (npmAuth) => gcp.generateDeployKongWorkflow(config, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'deploy-lb',
    render: (npmAuth) => gcp.generateDeployLbWorkflow(config, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'deploy-scheduled-jobs',
    render: (npmAuth) =>
      gcp.generateDeployScheduledJobsWorkflow(config, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'pr',
    render: (npmAuth) => gcp.generatePrWorkflow({ npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'remove-service',
    render: (npmAuth) => gcp.generateRemoveServiceWorkflow(config, { npmAuth }),
  },
  {
    provider: 'gcp',
    name: 'remove-detached-worker',
    render: (npmAuth) =>
      gcp.generateRemoveDetachedWorkerWorkflow(config, { npmAuth }),
  },

  // AWS — every workflow generator
  {
    provider: 'aws',
    name: 'deploy',
    render: (npmAuth) => aws.generateDeployWorkflow(config, { npmAuth }),
  },
  {
    provider: 'aws',
    name: 'deploy-services',
    render: (npmAuth) =>
      aws.generateDeployServicesWorkflow(config, services, { npmAuth }),
  },
  {
    provider: 'aws',
    name: 'deploy-infra',
    render: (npmAuth) => aws.generateDeployInfraWorkflow(config, { npmAuth }),
  },
  {
    provider: 'aws',
    name: 'deploy-kong',
    render: (npmAuth) => aws.generateDeployKongWorkflow(config, { npmAuth }),
  },
  {
    provider: 'aws',
    name: 'deploy-scheduled-jobs',
    render: (npmAuth) =>
      aws.generateDeployScheduledJobsWorkflow(config, { npmAuth }),
  },
  {
    provider: 'aws',
    name: 'pr',
    render: (npmAuth) => aws.generatePrWorkflow({ npmAuth }),
  },
  {
    provider: 'aws',
    name: 'remove-service',
    render: (npmAuth) => aws.generateRemoveServiceWorkflow(config, { npmAuth }),
  },
  {
    provider: 'aws',
    name: 'remove-detached-worker',
    render: (npmAuth) =>
      aws.generateRemoveDetachedWorkerWorkflow(config, { npmAuth }),
  },

  // Azure — every workflow generator
  {
    provider: 'azure',
    name: 'deploy',
    render: (npmAuth) => azure.generateDeployWorkflow(config, { npmAuth }),
  },
  {
    provider: 'azure',
    name: 'deploy-services',
    render: (npmAuth) =>
      azure.generateDeployServicesWorkflow(config, services, { npmAuth }),
  },
  {
    provider: 'azure',
    name: 'deploy-infra',
    render: (npmAuth) => azure.generateDeployInfraWorkflow(config, { npmAuth }),
  },
  {
    provider: 'azure',
    name: 'deploy-kong',
    render: (npmAuth) => azure.generateDeployKongWorkflow(config, { npmAuth }),
  },
  {
    provider: 'azure',
    name: 'deploy-scheduled-jobs',
    render: (npmAuth) =>
      azure.generateDeployScheduledJobsWorkflow(config, { npmAuth }),
  },
  {
    provider: 'azure',
    name: 'pr',
    render: (npmAuth) => azure.generatePrWorkflow({ npmAuth }),
  },
  {
    provider: 'azure',
    name: 'remove-service',
    render: (npmAuth) =>
      azure.generateRemoveServiceWorkflow(config, { npmAuth }),
  },
  {
    provider: 'azure',
    name: 'remove-detached-worker',
    render: (npmAuth) =>
      azure.generateRemoveDetachedWorkerWorkflow(config, { npmAuth }),
  },
];

describe('cross-provider NPM_TOKEN wiring', () => {
  describe('npmAuth: false (default)', () => {
    for (const c of cases) {
      it(`${c.provider}/${c.name} — output is parseable YAML and contains NO NPM_TOKEN`, () => {
        const output = c.render(false);
        expect(() => yaml.load(output)).not.toThrow();
        expect(output).not.toContain('NPM_TOKEN');
      });
    }
  });

  describe('npmAuth: true', () => {
    for (const c of cases) {
      it(`${c.provider}/${c.name} — output is parseable YAML`, () => {
        const output = c.render(true);
        expect(() => yaml.load(output)).not.toThrow();
      });

      it(`${c.provider}/${c.name} — emits NPM_TOKEN at the JOB-level env block (not step-level)`, () => {
        const output = c.render(true);
        const wf = yaml.load(output) as WorkflowShape;
        const job = findFirstJob(wf);

        // Job-level env contains NPM_TOKEN with the GH-secrets reference.
        expect(job.env).toBeDefined();
        expect(job.env?.NPM_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');

        // No individual step has its own NPM_TOKEN entry — env block is
        // job-level on purpose so every step inherits it via cascade.
        // (Step-level overrides for OTHER keys still work; we only assert
        // no step LOCALLY redeclares NPM_TOKEN.)
        for (const step of job.steps) {
          expect(step.env?.NPM_TOKEN).toBeUndefined();
        }
      });
    }
  });

  describe('cross-provider consistency', () => {
    it('every provider emits the same NPM_TOKEN env entry shape', () => {
      const tokenValues = new Set<string>();
      for (const c of cases) {
        const output = c.render(true);
        const wf = yaml.load(output) as WorkflowShape;
        const job = findFirstJob(wf);
        if (job.env?.NPM_TOKEN) {
          tokenValues.add(job.env.NPM_TOKEN);
        }
      }
      // Exactly one shape across all 24 generators × 3 providers.
      expect(tokenValues.size).toBe(1);
      expect(Array.from(tokenValues)[0]).toBe('${{ secrets.NPM_TOKEN }}');
    });
  });
});
