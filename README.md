# @tsdevstack/cli-infra

Infrastructure generation and deployment for [tsdevstack](https://tsdevstack.dev).

Generates Terraform for GCP, AWS, and Azure and drives the full deploy from a single config file: container builds, services, the Kong gateway, load balancers, database migrations, scheduled jobs, and CI/CD pipelines.

## Source-available mirror

This repository mirrors the `@tsdevstack/cli-infra` source from the tsdevstack monorepo. The package is bundled into the [`@tsdevstack/cli`](https://www.npmjs.com/package/@tsdevstack/cli) binary, so it is not published to npm or installed on its own.

To use it, install the CLI:

```bash
npx @tsdevstack/cli init
```

## Documentation

Guides, architecture, and the full command reference live at [tsdevstack.dev](https://tsdevstack.dev).

## Community

Join the Discord: [discord.gg/2EMFkqc8QR](https://discord.gg/2EMFkqc8QR)

## License

Apache-2.0
