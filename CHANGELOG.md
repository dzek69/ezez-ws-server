All notable changes to this project will be documented in this file.

The format is based on [EZEZ Changelog](https://ezez.dev/changelog/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-08-09
### Fixed
- crash on malformed data
- `broadcast` sending messages to unauthenticated clients
- repeated auth requests were handled, now they are rejected to avoid confusion and attacks
- leaks when onAuthRequest throws an error, this is now reported back to client as failed auth and reported to
`onError` callback
- added proper runtime types validation for protocol messages
- `close()` now terminates existing client connections
### Changed
- time to authenticate can now be set up via options
- docs update to make it clear that it is expected that callbacks never throw/reject
### Added
- options to control max queue size in bytes and what to do when it overflows
### Breaking
- default max payload size is now 1MB instead of 100MB
- it's not disallowed to send messages with reserved protocol prefix, previously such messages went through and were
only disallowed on types level
- fixed CPU DoS via huge serialized BigInt values, this can be breaking for unusual scenarios, use `maxBigIntLength`
option to control the deserializer's BigInt length limit (default 10000, `Infinity` disables it)

## [0.5.1] - 2026-06-04
### Dev
- deps bump

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
