# Flashbake Infrastructure Mono Repo

This repository contains implementations for the Flashbake Relay and the Flashbake Baker endpoint.

Flashbake is a suite of software allowing a Tezos user to send transactions directly to a baker.

Flashbake Documentation is at [https://flashbake.xyz](https://flashbake.xyz/docs/intro)

### Typescript packages

- `baker-endpoint/` - Implementation of a baker endpoint.
- `core/` - Shared code between components, published as `@flashbake/core`
- `relay/` - Private relay to bakers

## Development

Flashbake core components ([`baker-endpoint`](baker-endpoint/) and [`relay`](relay/)) are written in TypeScript.

See README's in the sub-folders for build instructions.

Flashbake integration testing and development is best done in a [tezos-k8s](https://tezos-k8s.xyz) environment using the [sandbox](https://github.com/flashbake/sandbox) repository. See README of this repository for details.

### Helm charts

- `helm/`
