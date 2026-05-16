# Versioning

Current main release: `v1.0.0`.

Every merge into `main` must include the corresponding app version:

- Update `package.json` `version`.
- Update `APP_VERSION` in `components/gpf-cloud-app.tsx`.
- Use semantic versioning: patch for fixes, minor for new usable features, major for breaking operational changes.
- Keep the visible app version in the UI aligned with the released `main` version.
