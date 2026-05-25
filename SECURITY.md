# Reporting a Security Issue

Please do **not** open public GitHub issues for security reports.

Instead, email **bg9m9r@proton.me** with:

- A description of the issue
- Steps to reproduce (or a minimal proof-of-concept)
- The affected commit / branch / deployed URL, if known
- Whether you intend to disclose publicly, and on what timeline

You should receive an acknowledgement within 7 days. If you do not, please re-send the email or open a private GitHub Security Advisory on the relevant repository.

## Supported versions

Only the `main` branch of each Majik repository is supported. Older commits are not patched; pin to a recent commit and update regularly.

## Scope

In scope:

- `majik.core` (engine, server, console importer)
- `majik.portal` (web client)
- Deployed services at `api.majik.tech` and `majik.tech`

Out of scope:

- Wizards of the Coast intellectual property (this project operates under the [WotC Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy); IP concerns go to Wizards, not us)
- Third-party hosting providers (Render, Auth0) — report directly to them
- Social-engineering or physical-access attacks against the maintainer

## Coordinated disclosure

We will work with reporters to publish a fix and advisory at the same time. Credit will be given in the advisory unless the reporter requests anonymity.
