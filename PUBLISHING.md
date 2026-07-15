# Publishing

In order for other people to install and use this component, you can publish the
package to npm.

You will first need to have an npmjs account with permissions to push to your
package name.

If this is your first time, here are the recommended steps:

1. Ensure the package.json "name" matches what you want it to be called. It
   should either be like `my-package` or `@my-org/my-package`. If it's the
   latter, ensure you have an npmjs account with permissions to push to
   `my-org`.
2. `npm login` to log in to npmjs, or configure a granular access token with
   permission to publish the package.
3. `pnpm install --frozen-lockfile` to install the dependencies from
   `pnpm-lock.yaml`.
4. `npm pack --dry-run` to run the clean build, tests, lint, typecheck, and
   inspect the package contents without creating a tarball.
5. (Optional) `npm pack` will create a `.tgz` file of the package. You can then
   try installing it in another project with
   `npm install ./path/to/your-package.tgz` to sanity check that it works as
   expected. You can remove the `.tgz` file afterward.
6. `npm publish --access public` to publish the package to npm. The explicit
   access flag is required for the first public publish of a scoped package.
7. Enter an npm one-time password if the account requires 2FA for writes.
8. `git tag v0.1.0` to tag the new version.
9. `git push --follow-tags` to push the tags to the repository. This way, other
   contributors can always see what code was published with each version.
   Running `npm version ...` will create these tags and commits automatically.

After the initial publish, you can use the release scripts documented below,
which will validate, version, publish, and push the tag automatically.

## Package scripts for releasing

In package.json, there are some scripts that are useful for doing releases.

- `preversion` makes a clean build and runs tests, lint, and typecheck before
  marking a new version.
- `prepack` performs the same validation before either packing or publishing.

These lifecycle scripts run automatically when using the deployment commands.

## Deploying a new alpha version

```sh
npm run alpha
```

This will create a prerelease version with an `@alpha` tag. It will then publish
the package to npm and push the code and new tag. Users can install the package
with `npm install @your-package@alpha`.

## Deploying a new release version

```sh
npm run release
```

This will create a patch version and publish as `latest`. It will then publish
the package to npm and push the code and new tag. To publish a new minor or
major version, you can run the commands manually:

```sh
npm version minor # or major
npm publish --access public
git push --follow-tags
```

## Building a one-off package

```sh
npm pack --dry-run
npm pack
```

You can then provide the .tgz file to others to install via
`npm install ./path/to/your-package.tgz`.
