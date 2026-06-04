All notable changes to this project will be documented in this file.

The format is based on [EZEZ Changelog](https://ezez.dev/changelog/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [UNRELEASED]
(nothing yet)

## [0.5.0] - 2026-06-04
### Added
- `context` prop for each connected client

## [0.4.0] - 2026-02-19
### Breaking
- `onMessage` is always called, even for replies
### Changed
- added docs

## [0.3.0] - 2026-02-18
### Added
- `onDisconnect` callback
- `onError` callback
- `disconnect` method

## [0.2.7] - 2026-02-18
### Fixed
- `OnCallback` not exported

## [0.2.6] - 2026-01-28
### Fixed
- not being able to receive more than 4 items in a single message

## [0.2.5] - 2026-01-25
### Changed
- added `EZEZServerClient` type export

## [0.2.4] - 2026-01-24
### Changed
- added `client` property to EZEZServerClient that gets raw Websocket client instance
- added `OnCallback` type helper

## [0.2.3] - 2025-12-04
### Fixed
- esm build had no files extensions on imports

## [0.2.2] - 2025-10-24
### Fixed
- broken messages with multi bytes characters

## [0.2.1] - 2025-10-24
### Fixed
- `start()` never resolves on `noServer: true`

## [0.2.0] - 2025-10-23
### Added
- proper support for external server mode
### Dev
- deps bump

## [0.1.0] - 2025-05-26
### Added
- first version
