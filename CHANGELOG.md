# [1.1.0](https://github.com/sysutils-ts/sysutils/compare/v1.0.0...v1.1.0) (2026-07-19)


### Bug Fixes

* allow resolve-version job to verify git push permissions ([f3b1703](https://github.com/sysutils-ts/sysutils/commit/f3b17034fa6f0dbee1793ee287c67e37aeb2be97))
* bootstrap per-platform packages with token fallback ([ac44146](https://github.com/sysutils-ts/sysutils/commit/ac4414685fc99277d7e791ba177c8900d3d6e254))
* silence semantic-release logs while resolving version ([c6c2523](https://github.com/sysutils-ts/sysutils/commit/c6c2523b9e34c9e244b2994834a7841403ca4dd4))
* use steps context instead of secrets in if conditions ([8993d4c](https://github.com/sysutils-ts/sysutils/commit/8993d4c18df149862171eb0c1c744176e06465ca))
* validate NPM_TOKEN does not require 2FA in CI ([90fe712](https://github.com/sysutils-ts/sysutils/commit/90fe712f783ace6f74eed0ea0a093311c685b6dc))
* write version output directly to GITHUB_OUTPUT ([cc728a4](https://github.com/sysutils-ts/sysutils/commit/cc728a4e39c776cd5d39b65be1892fe1a060200e))


### Features

* split native binaries into per-platform optional dependencies ([#16](https://github.com/sysutils-ts/sysutils/issues/16)) ([ad2640a](https://github.com/sysutils-ts/sysutils/commit/ad2640ad98d21f03d32fbd35abac5baef1eaf671))

# 1.0.0 (2026-07-19)


### Bug Fixes

* **publish:** remove provenance config so local placeholder publish works [skip ci] ([#9](https://github.com/sysutils-ts/sysutils/issues/9)) ([6f05dfc](https://github.com/sysutils-ts/sysutils/commit/6f05dfcbf7abc867cb648b2914861e3f30b2c6e8))


### Features

* **ps-rust:** implement native Rust backend ([5bf457d](https://github.com/sysutils-ts/sysutils/commit/5bf457df170c6727164d0b1a63a8fd7cf0a4e74f))
* **ps:** integrate Rust and .NET backends with backend-agnostic Node wrapper ([14a583b](https://github.com/sysutils-ts/sysutils/commit/14a583bda46d8fec604159ca90505e72521afb39))


### Performance Improvements

* **ps:** low-level NtQuery refactor + in-process Node-API .NET backend ([#6](https://github.com/sysutils-ts/sysutils/issues/6)) ([92e88e2](https://github.com/sysutils-ts/sysutils/commit/92e88e266c7b155a066263810c3b9854e8bcf7d0))
